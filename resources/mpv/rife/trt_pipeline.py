"""Prepared TensorRT RIFE graph. Playback never compiles or downloads an engine."""
from array import array
from fractions import Fraction
from math import isfinite
from pathlib import Path
from threading import RLock
import vapoursynth as vs


class CfrTiming:
    def __init__(self, fps):
        self.lock = RLock()
        self.expected = 1 / fps
        self.next = 0
        self.pending = {}
        self.error = 0.
        self.count = 0
        self.accepted = True

    def accept(self, index, duration):
        with self.lock:
            return self.accept_locked(index, duration)

    def accept_locked(self, index, duration):
        if not self.accepted:
            return False
        if abs(float(duration - self.expected)) > 1.1e-3:
            self.accepted = False
            return False
        if index < self.next:
            return True
        if index > self.next + 120:
            self.next = index
            self.pending.clear()
            self.error, self.count = 0., 0
        self.pending[index] = duration
        # Lookahead and concurrent callbacks may revisit frames or arrive
        # out of order. Accumulate each contiguous source duration once.
        while self.next in self.pending:
            self.error += float(self.pending.pop(self.next) - self.expected)
            self.next += 1
            self.count += 1
            self.accepted = abs(self.error) <= 1.1e-3 + self.count * 1e-6
            if not self.accepted:
                return False
            if self.count == 120:
                self.error, self.count = 0., 0
        return self.accepted


def pixel_range(props):
    if '_Range' in props:
        return props['_Range']
    legacy = props.get('_ColorRange', -1)
    return 1 - legacy if legacy in (0, 1) else -1


def rife_inputs(clip):
    """Immutable coordinate planes without upstream's Python per-pixel loop."""
    core = vs.core
    blank = core.std.BlankClip(clip, format=vs.GRAYS, length=1, keep=True)

    def coordinate(horizontal):
        stored = []
        def fill(n, f):
            if stored:
                return stored[0]
            output = f.copy()
            stride = output.get_stride(0)
            target = memoryview(output[0]).cast('B')
            if horizontal:
                row = array('f', (2*x/(clip.width-1)-1 for x in range(clip.width))).tobytes()
                for y in range(clip.height):
                    target[y*stride:y*stride+len(row)] = row
            else:
                for y in range(clip.height):
                    row = array('f', [2*y/(clip.height-1)-1]) * clip.width
                    target[y*stride:y*stride+clip.width*4] = row.tobytes()
            stored.append(output)
            return output
        return core.std.ModifyFrame(blank, clips=blank, selector=fill).std.Loop(times=clip.num_frames)

    return [coordinate(True), coordinate(False),
            core.std.BlankClip(clip, format=vs.GRAYS, color=2/(clip.width-1), keep=True),
            core.std.BlankClip(clip, format=vs.GRAYS, color=2/(clip.height-1), keep=True)]


def build_rife_filter(source, options):
    core = vs.core
    if source.format is None or not 2 <= source.width <= 3840 or not 2 <= source.height <= 2160:
        raise ValueError('RIFE requires a constant video format up to 3840x2160')
    fps = Fraction(int(options['fps_num']), int(options['fps_den']))
    if not 0 < fps <= Fraction(60001, 1000):
        raise ValueError('Unsupported RIFE frame rate')
    factor = options.get('factor', 2)
    if (type(factor) not in (int, float) or not 1.5 <= factor <= 15
            or not isfinite(factor) or factor * 2 != int(factor * 2)):
        raise ValueError('RIFE requires a finite half-step factor from 1.5 to 15')
    factor = Fraction(factor)
    factor_num, factor_den = factor.numerator, factor.denominator
    implementation = options.get('implementation', 1)
    if type(implementation) is not int or implementation not in (1, 2):
        raise ValueError('Unsupported RIFE model implementation')
    alignment = options.get('alignment', 1 if implementation == 2 else 128)
    if not ((implementation == 1 and alignment in (32, 64, 128)) or (implementation == 2 and alignment == 1)):
        raise ValueError('Unsupported RIFE model alignment')
    streams = options.get('num_streams', 1)
    if type(streams) is not int or not 1 <= streams <= 4:
        raise ValueError('Unsupported RIFE inference stream count')
    engine = Path(options['engine_path'])
    if not engine.is_file() or engine.stat().st_size < 1024:
        raise ValueError('A complete prepared RIFE engine is required')
    streaming = bool(options.get('streaming', True))
    timing = CfrTiming(fps)
    frame_count = (source.num_frames * factor_num + factor_den - 1) // factor_den

    def sample(clip):
        # Interleaving by the numerator first would exceed VS's signed frame
        # limit for mpv's virtual input at factors above 8x. Sample a block of
        # one/two source frames directly, before constructing any inference.
        if factor_den == 1:
            return core.std.Interleave([clip] * factor_num, modify_duration=False)
        paired = clip + clip[-1:] if clip.num_frames % 2 else clip
        phases = [core.std.SelectEvery(paired, cycle=2, offsets=i, modify_duration=False)
                  for i in range(2)]
        return core.std.Interleave([phases[i * factor_den // factor_num]
            for i in range(factor_num)], modify_duration=False)[:frame_count]

    original = sample(source)
    output_fps = fps * factor
    template = core.std.BlankClip(source, length=original.num_frames,
                                  fpsnum=output_fps.numerator, fpsden=output_fps.denominator, keep=True)
    neighbour = source[1:] + source[-1:] if source.num_frames > 1 else source
    next_props = sample(neighbour)
    disabled = None
    bypasses = {}
    generated = None
    statistics = None
    conversions = {}
    graph_lock = RLock()

    def is_last(n, props):
        return (props.get('_TigerestLastFrame') == 1 if streaming
                else n * factor_den // factor_num == source.num_frames - 1)

    def stamp(clip, synthesized, reason=''):
        clip = core.std.RemoveFrameProps(clip, props=['_TigerestRifeTimeMs'])
        clip = core.std.SetFrameProps(clip, _TigerestRifeSynthesized=synthesized,
                                     _TigerestRifeTimingAvailable=0, _TigerestRifeReason=reason)
        normalize = reason in ('', 'cut', 'eof')

        def duration(n, f):
            output = f[0].copy()
            props = f[1].props
            phase = n * factor_den % factor_num
            span = min(factor_den, factor_num - phase)
            if not is_last(n, props) and len(f) == 2:
                span = factor_den
            if normalize:
                value = Fraction(span, factor_num) / fps
            else:
                num, den = props.get('_DurationNum', 0), props.get('_DurationDen', 0)
                if num <= 0 or den <= 0:
                    return output
                value = Fraction(num * span, den * factor_num)
                if len(f) == 3:
                    num, den = f[2].props.get('_DurationNum', 0), f[2].props.get('_DurationDen', 0)
                    if num <= 0 or den <= 0:
                        return output
                    value += Fraction(num * (factor_den - span), den * factor_num)
            output.props['_DurationNum'] = value.numerator
            output.props['_DurationDen'] = value.denominator
            return output

        current = core.std.ModifyFrame(template, clips=[clip, original], selector=duration)
        if normalize or factor_den == 1:
            return current
        crossing = core.std.ModifyFrame(template, clips=[clip, original, next_props], selector=duration)

        def choose_duration(n, f):
            # A fractional slot can span two source durations during bypass.
            # Keep this lookahead lazy, especially for a streaming EOF frame.
            can_look_ahead = (f.props.get('_TigerestLastFrame') == 0 if streaming
                              else not is_last(n, f.props))
            if n * factor_den % factor_num + factor_den > factor_num and can_look_ahead:
                return crossing
            return current

        return core.std.FrameEval(template, eval=choose_duration, prop_src=original)

    def bypass(reason=''):
        if reason not in bypasses:
            bypasses[reason] = stamp(original, 0, reason)
        return bypasses[reason]

    def eligibility(index, props):
        if props.get('_TigerestColorKnown', 1) == 0:
            return 'unknown-color'
        transfer = props.get('_Transfer', -1)
        if transfer in (16, 18):
            return 'hdr'
        matrices = (0,) if source.format.color_family == vs.RGB else (1, 5, 6)
        if (props.get('_Matrix', -1) not in matrices or pixel_range(props) not in (0, 1)
                or transfer not in (1, 6, 13) or props.get('_Primaries', -1) not in (1, 5, 6)
                or props.get('_ChromaLocation', 0) not in range(6)):
            return 'unknown-color'
        if props.get('_FieldBased', -1) != 0:
            return 'interlaced'
        num, den = props.get('_DurationNum', 0), props.get('_DurationDen', 0)
        if num <= 0 or den <= 0 or not timing.accept(index, Fraction(num, den)):
            return 'vfr'
        if streaming and props.get('_TigerestLastFrame', -1) not in (0, 1):
            return 'runtime-eof-missing'
        return ''

    def disable(reason):
        nonlocal disabled
        disabled = reason
        return bypass(reason)

    # Nodes are constructed after metadata qualification. They remain lazy:
    # scene statistics cannot request a neighbour until the EOF check succeeds.
    rgb = core.resize.Bicubic(source, format=vs.RGBH if implementation == 2 else vs.RGBS, range=1)
    right_rgb = rgb[1:] + rgb[-1:] if source.num_frames > 1 else rgb

    def scene_stats():
        nonlocal statistics
        if statistics is None:
            statistics = [sample(stat) for stat in
                          (core.std.PlaneStats(rgb, right_rgb, plane=p) for p in range(3))]
        return statistics

    def prediction(matrix, color_range, chroma):
        # VS evaluates multiple output frames concurrently. Native model
        # creation releases the GIL, so the lazy graph needs its own lock.
        with graph_lock:
            return prediction_locked(matrix, color_range, chroma)

    def prediction_locked(matrix, color_range, chroma):
        nonlocal generated
        if generated is None:
            width = ((source.width + alignment - 1) // alignment) * alignment
            height = ((source.height + alignment - 1) // alignment) * alignment
            padded = rgb
            if width != source.width or height != source.height:
                padded = core.std.AddBorders(rgb, right=width-source.width, bottom=height-source.height,
                                              color=[0., 0., 0.])
            next_padded = padded[1:] + padded[-1:] if source.num_frames > 1 else padded
            left = sample(padded)
            right = sample(next_padded)
            # One inference context covers all timepoints. Original slots and
            # EOF slots are never requested from this node by FrameEval.
            timepoints = core.std.Interleave([core.std.BlankClip(padded, length=1,
                format=vs.GRAYH if implementation == 2 else vs.GRAYS,
                color=(i * factor_den % factor_num) / factor_num, keep=True) for i in range(factor_num)])
            timepoints = core.std.Loop(timepoints,
                times=(source.num_frames + factor_den - 1) // factor_den)[:frame_count]
            inputs = [left, right, timepoints]
            if implementation == 1:
                inputs += rife_inputs(left)
            generated = core.trt.Model(inputs,
                                      engine_path=str(engine), device_id=int(options.get('device_id', 0)),
                                      use_cuda_graph=True, num_streams=streams)
            if width != source.width or height != source.height:
                generated = core.std.CropAbs(generated, width=source.width, height=source.height)
        key = (matrix, color_range, chroma)
        if key not in conversions:
            converted = core.resize.Bicubic(generated, format=source.format.id, matrix=matrix,
                                            range=color_range, chromaloc=chroma, dither_type='ordered')
            conversions[key] = stamp(converted, 1)
        return conversions[key]

    def choose(n, f):
        if disabled:
            return bypass(disabled)
        props = f.props
        index, phase = divmod(n * factor_den, factor_num)
        reason = eligibility(index, props)
        if reason:
            return disable(reason)
        if phase == 0:
            return bypass()
        if is_last(n, props):
            return bypass('eof')
        matrix, color_range = props['_Matrix'], pixel_range(props)
        chroma = props.get('_ChromaLocation', 0)

        def check_neighbour(n, f):
            reason = eligibility(n * factor_den // factor_num + 1, f.props)
            if reason:
                return disable(reason)

            def check_cut(n, f):
                if sum(frame.props['PlaneStatsDiff'] for frame in f) / 3 >= 0.25:
                    return bypass('cut')
                return prediction(matrix, color_range, chroma)

            return core.std.FrameEval(template, eval=check_cut, prop_src=scene_stats())

        return core.std.FrameEval(template, eval=check_neighbour, prop_src=next_props)

    output = core.std.FrameEval(template, eval=choose, prop_src=original)
    if options.get('monitor', True):
        if not hasattr(core, 'tigerest'):
            core.std.LoadPlugin(path=options['plugin_path'])
        output = core.tigerest.Monitor(output, session=int(options.get('session', 0)),
                                      factor=factor_num, factor_den=factor_den)
    return output
