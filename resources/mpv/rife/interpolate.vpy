"""Bundled mpv bridge. Decode, timestamps, audio and rendering stay in mpv."""
import json
from pathlib import Path
import vapoursynth as vs


def _build_rife_filter(source, options):
    core=vs.core
    core.num_threads=2
    core.max_cache_size=128
    if source.format is None or source.width<2 or source.height<2:
        raise ValueError('RIFE requires a constant video format')
    if not any(plugin.identifier=='io.github.tigerest.rife' for plugin in core.plugins()):
        core.std.LoadPlugin(path=options['plugin_path'])
    fps_num,fps_den=int(options['fps_num']),int(options['fps_den'])
    if fps_num<=0 or fps_den<=0 or fps_num/fps_den>30.001:
        raise ValueError('Unsupported RIFE frame rate')
    model=Path(options['model_path'])
    manifest=json.loads((model/'manifest.json').read_text())
    width,height=int(manifest['width']),int(manifest['height'])
    original=core.std.Interleave([source,source],modify_duration=True)
    template=core.std.BlankClip(source,length=original.num_frames,fpsnum=fps_num*2,fpsden=fps_den,keep=True)
    bypasses={}
    disabled_reason=None

    def bypass(reason):
        if reason not in bypasses:
            bypasses[reason]=core.std.SetFrameProps(original,_TigerestRifeSynthesized=0,
                                                   _TigerestRifeTimeMs=0.,_TigerestRifeReason=reason)
        return bypasses[reason]

    def disable(reason):
        nonlocal disabled_reason
        disabled_reason=reason
        return bypass(reason)

    if source.width>width or source.height>height:
        return core.std.FrameEval(template,eval=lambda n:bypass('unsupported-size'),clip_src=[original])
    # These nodes are lazy: unsupported color metadata is rejected by the outer
    # FrameEval before any frame is requested from the RGB conversion/model.
    rgb=core.resize.Bicubic(source,format=vs.RGBS,range=1)
    if source.width!=width or source.height!=height:
        rgb=core.std.AddBorders(rgb,right=width-source.width,bottom=height-source.height,color=[0.,0.,0.])
    native=core.tigerest.RIFE(rgb,model_path=str(model),fps_num=fps_num,fps_den=fps_den,
        compute_policy=options.get('compute_policy','cpu-gpu'),pipeline=options.get('pipeline','monolithic'),
        generation=int(options.get('generation',0)),streaming=int(options.get('streaming',True)),
        content_width=source.width,content_height=source.height)
    if native.width!=source.width or native.height!=source.height:
        native=core.std.CropAbs(native,width=source.width,height=source.height)
    timing_keys=('_DurationNum','_DurationDen','_TigerestRifeSynthesized','_TigerestRifeTimeMs','_TigerestRifeReason')

    def original_timing(n,f):
        out=f[0].copy()
        for key in timing_keys:
            if key in f[1].props:out.props[key]=f[1].props[key]
        return out

    timed_original=core.std.ModifyFrame(original,clips=[original,native],selector=original_timing)
    conversions={}

    def pixel_range(props):
        if '_Range' in props:return props['_Range']
        legacy=props.get('_ColorRange',-1)
        return 1-legacy if legacy in (0,1) else -1

    def choose(n,f):
        if disabled_reason:return bypass(disabled_reason)
        props=f.props
        if props.get('_TigerestColorKnown',1)==0:return disable('unknown-color')
        transfer=props.get('_Transfer',-1)
        if transfer in (16,18):return disable('hdr')
        matrix=props.get('_Matrix',-1)
        color_range=pixel_range(props)
        matrices=(0,) if source.format.color_family==vs.RGB else (1,5,6)
        if (matrix not in matrices or color_range not in (0,1) or
            transfer not in (1,6,13) or props.get('_Primaries',-1) not in (1,5,6)):
            return disable('unknown-color')
        if props.get('_FieldBased',-1)!=0:return disable('interlaced')
        # Interleave already split the observed duration. Native code also
        # checks accumulated timing drift on the undoubled RGB input.
        num,den=props.get('_DurationNum',0),props.get('_DurationDen',0)
        if num<=0 or den<=0 or abs(2*num/den-fps_den/fps_num)>1.1e-3:
            return disable('vfr')
        chroma=props.get('_ChromaLocation',0)
        if chroma not in range(6):return disable('unknown-color')
        key=(matrix,color_range,chroma)
        if key not in conversions:
            converted=core.resize.Bicubic(native,format=source.format.id,matrix=matrix,
                                           range=color_range,chromaloc=chroma,dither_type='ordered')
            def select(n,f,generated=converted):
                reason=f.props.get('_TigerestRifeReason','')
                if reason and reason not in ('cut','eof'):disable(reason)
                return generated if f.props.get('_TigerestRifeSynthesized',0) else timed_original
            conversions[key]=core.std.FrameEval(template,eval=select,prop_src=native,
                                                 clip_src=[converted,timed_original])
        return conversions[key]

    return core.std.FrameEval(template,eval=choose,prop_src=original,clip_src=[original,native])


def build_rife_filter(source, options):
    output=_build_rife_filter(source,options)
    return vs.core.tigerest.Monitor(output,session=int(options.get('session',0)))


if 'video_in' in globals():
    build_rife_filter(video_in,json.loads(user_data)).set_output()
