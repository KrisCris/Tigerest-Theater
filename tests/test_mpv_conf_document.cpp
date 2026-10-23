#include <QtTest/QtTest>

#include "player/MpvConfDocument.h"

#include <QFile>
#include <QJsonDocument>

using namespace MpvConf;

class TestMpvConfDocument : public QObject
{
  Q_OBJECT

private slots:
  void initTestCase();
  void splitsAndComposesWithoutLosingText();
  void unstructuredTextIsAllUser();
  void parsesMpvSyntax();
  void quotesValuesMpvWouldTruncate();
  void defaultConfigurationValidatesCleanly();
  void reportsInvalidLines();
  void decidesOwnership();
  void validatesFilters();
  void suspendsAndRestoresConflictingLines();
  void neutralizesLockedOptions();
  void editsOptionsInPlace();
  void insertsIntoTheRightSection();
  void resolvesInheritedValues();
  void resolvesProfilesForTheHost();
  void findsMissingShaders();

private:
  Rules m_rules;
  QString m_default;
  QString m_mpvRoot;
};

namespace
{
QByteArray readFile(const QString& path)
{
  QFile file(path);
  if (!file.open(QIODevice::ReadOnly))
    qFatal("missing fixture %s", qPrintable(path));
  return file.readAll();
}

QStringList codes(const QList<Diagnostic>& diagnostics, const QString& severity = QString())
{
  QStringList result;
  for (const Diagnostic& diagnostic : diagnostics)
    if (severity.isEmpty() || diagnostic.severity == severity)
      result << QStringLiteral("%1:%2").arg(diagnostic.line).arg(diagnostic.code);
  return result;
}
}

void TestMpvConfDocument::initTestCase()
{
  const QString root = QStringLiteral(SOURCE_ROOT);
  m_rules = Rules::fromJson(QJsonDocument::fromJson(readFile(root + "/resources/mpvconf/options.json")).object(),
                            QJsonDocument::fromJson(readFile(root + "/resources/mpvconf/mpv-options.json")).object());
  m_default = QString::fromUtf8(readFile(root + "/resources/mpv/mpv.default.conf"));
  m_mpvRoot = root + "/resources/mpv";
  QVERIFY(m_rules.mpvOptions.size() > 500);
  QVERIFY(m_rules.locked.contains(QStringLiteral("input-ipc-server")));
}

void TestMpvConfDocument::splitsAndComposesWithoutLosingText()
{
  const QString head = HeadBegin + "\n# 版本\n" + HeadEnd + "\n";
  const QString tail = TailBegin + "\n[default]\nosc=no\n" + TailEnd + "\n";
  const QString file = compose(head, m_default, tail);
  const Parts parts = split(file);
  QVERIFY(parts.structured);
  QCOMPARE(parts.head, head);
  QCOMPARE(parts.tail, tail);
  QCOMPARE(parts.user, m_default);
  QCOMPARE(compose(parts.head, parts.user, parts.tail), file);
  // Windows line endings from an external editor do not change the content.
  QString crlf = file;
  crlf.replace("\n", "\r\n");
  QCOMPARE(split(crlf).user, m_default);
  // Lines appended after the tail by another program stay in the user area.
  const Parts appended = split(file + QStringLiteral("deband=no\n"));
  QVERIFY(appended.structured);
  QVERIFY(appended.user.endsWith(QStringLiteral("deband=no\n")));
  QCOMPARE(appended.tail, tail);
}

void TestMpvConfDocument::unstructuredTextIsAllUser()
{
  const Parts parts = split(QStringLiteral("deband=no\n[x]\nscale=bilinear\n"));
  QVERIFY(!parts.structured);
  QCOMPARE(parts.user, QStringLiteral("deband=no\n[x]\nscale=bilinear\n"));
}

void TestMpvConfDocument::parsesMpvSyntax()
{
  QString key, value;
  bool hasValue = false;
  QVERIFY(parseOption(QStringLiteral("deband = yes # trailing"), &key, &value, &hasValue));
  QCOMPARE(key, QStringLiteral("deband"));
  QCOMPARE(value, QStringLiteral("yes"));
  QVERIFY(parseOption(QStringLiteral("sub-color=\"#FF0000\""), &key, &value, &hasValue));
  QCOMPARE(value, QStringLiteral("#FF0000"));
  QVERIFY(parseOption(QStringLiteral("sub-font=%5%a\"b#c"), &key, &value, &hasValue));
  QCOMPARE(value, QStringLiteral("a\"b#c"));
  QVERIFY(parseOption(QStringLiteral("sub-font=Noto#x"), &key, &value, &hasValue));
  QCOMPARE(value, QStringLiteral("Noto"));
  QVERIFY(parseOption(QStringLiteral("fs"), &key, &value, &hasValue));
  QVERIFY(!hasValue);
  QVERIFY(parseOption(QStringLiteral("--no-osc"), &key, &value, &hasValue));
  QCOMPARE(key, QStringLiteral("no-osc"));
  QVERIFY(!parseOption(QStringLiteral("this line is broken"), &key, &value, &hasValue));
  QVERIFY(!parseOption(QStringLiteral("sub-font=\"unterminated"), &key, &value, &hasValue));

  const QList<Line> lines = parse(QStringLiteral("a=1\n[p]\n# c\nb=2\n[default]\nc=3\n"));
  QCOMPARE(lines[0].section, QStringLiteral("default"));
  QCOMPARE(lines[3].section, QStringLiteral("p"));
  QCOMPARE(lines[5].section, QStringLiteral("default"));
  QCOMPARE(lines[2].kind, Line::Comment);
}

void TestMpvConfDocument::quotesValuesMpvWouldTruncate()
{
  QCOMPARE(formatOption(QStringLiteral("sub-color"), QStringLiteral("#FFFFFFFF")),
           QStringLiteral("sub-color=\"#FFFFFFFF\""));
  QCOMPARE(formatOption(QStringLiteral("sub-font"), QStringLiteral("a\"b#c")),
           QStringLiteral("sub-font=%5%a\"b#c"));
  QCOMPARE(formatOption(QStringLiteral("sub-font"), QStringLiteral("Segoe UI")),
           QStringLiteral("sub-font=Segoe UI"));
  QString value;
  QVERIFY(parseOption(formatOption(QStringLiteral("x"), QStringLiteral(" 前后空格 ")), nullptr, &value, nullptr));
  QCOMPARE(value, QStringLiteral(" 前后空格 "));
}

void TestMpvConfDocument::defaultConfigurationValidatesCleanly()
{
  ValidationContext context;
  context.configDir = m_mpvRoot;
  const QList<Diagnostic> diagnostics = validate(m_default, m_rules, context);
  QVERIFY2(diagnostics.isEmpty(), qPrintable(codes(diagnostics).join(", ")));
}

void TestMpvConfDocument::reportsInvalidLines()
{
  const QString text = QStringLiteral(
    "this line is broken\n"      // 1 syntax
    "not-an-option=1\n"          // 2 unknown
    "deband=maybe\n"             // 3 value
    "deband-iterations=99\n"     // 4 range
    "scale=fancy\n"              // 5 value
    "demuxer-max-back-bytes=lots\n" // 6 value
    "profile=tigerest-default\n" // 7 locked (global startup profile)
    "vo=gpu\n"                   // 8 locked
    "sub-scale=2\n"              // 9 page owned
    "osd-level=1\n"              // 10
    "osd-level=2\n"              // 11 duplicate warning
    "[mine]\n"                   // 12
    "profile=nowhere\n"          // 13 missing profile
    "profile=high-quality\n"     // 14 builtin ok
    "[broken\n");                // 15 syntax
  ValidationContext context;
  context.configDir = m_mpvRoot;
  const QList<Diagnostic> diagnostics = validate(text, m_rules, context);
  const QStringList errors = codes(diagnostics, QStringLiteral("error"));
  for (const QString& expected : {"1:syntax", "2:unknown-option", "3:value", "4:range", "5:value", "6:value",
                                  "7:locked", "8:locked", "9:page-owned", "13:missing-profile", "15:syntax"})
    QVERIFY2(errors.contains(expected), qPrintable(expected + QStringLiteral(" not in ") + errors.join(", ")));
  QVERIFY(!errors.contains(QStringLiteral("14:missing-profile")));
  QVERIFY(codes(diagnostics, QStringLiteral("warning")).contains(QStringLiteral("11:duplicate")));
}

void TestMpvConfDocument::decidesOwnership()
{
  const QVariantMap settings{{QStringLiteral("video.aspect"), QStringLiteral("normal")}};
  QCOMPARE(m_rules.ownership(QStringLiteral("vo"), settings).kind, Ownership::Locked);
  QCOMPARE(m_rules.ownership(QStringLiteral("script-opts-append"), settings).kind, Ownership::Locked);
  QCOMPARE(m_rules.ownership(QStringLiteral("glsl-shader"), settings).kind, Ownership::Free);
  QCOMPARE(m_rules.ownership(QStringLiteral("hwdec"), settings).kind, Ownership::Page);
  QCOMPARE(m_rules.ownership(QStringLiteral("deband"), settings).kind, Ownership::Free);
  QCOMPARE(m_rules.ownership(QStringLiteral("video-aspect-override"), settings).kind, Ownership::Page);
  const QVariantMap custom{{QStringLiteral("video.aspect"), QStringLiteral("custom")}};
  QCOMPARE(m_rules.ownership(QStringLiteral("video-aspect-override"), custom).kind, Ownership::Free);
  QCOMPARE(m_rules.baseKey(QStringLiteral("no-deband")), QStringLiteral("deband"));
  QCOMPARE(m_rules.baseKey(QStringLiteral("vf-append")), QStringLiteral("vf"));
}

void TestMpvConfDocument::validatesFilters()
{
  const QList<FilterEntry> filters = parseFilters(QStringLiteral("@user-1:lavfi=[eq=gamma=1.2,hflip],@user-2:hflip"));
  QCOMPARE(filters.size(), 2);
  QCOMPARE(filters[0].label, QStringLiteral("user-1"));
  QCOMPARE(filters[0].name, QStringLiteral("lavfi"));
  QCOMPARE(filters[1].name, QStringLiteral("hflip"));

  const QString text = QStringLiteral(
    "vf-append=hflip\n"                 // 1 missing label
    "vf-append=@user-1:nosuchfilter\n"  // 2 unknown filter
    "vf-append=@user-2:fps=60\n"        // 3 frame-rate warning
    "vf-append=@user-2:hflip\n"         // 4 duplicate label
    "vf-clr\n"                          // 5 clears the chain
    "[p]\n"
    "vf-append=@user-3:hflip\n");       // 7 not allowed in a profile
  ValidationContext context;
  context.settings = {{QStringLiteral("video.hardwareDecoding"), QStringLiteral("copy")}};
  const QList<Diagnostic> diagnostics = validate(text, m_rules, context);
  const QStringList all = codes(diagnostics);
  for (const QString& expected : {"1:vf-label", "2:vf-name", "3:vf-framerate", "4:vf-label", "5:vf-clear", "7:vf-scope"})
    QVERIFY2(all.contains(expected), qPrintable(expected + QStringLiteral(" not in ") + all.join(", ")));

  context.settings.insert(QStringLiteral("video.hardwareDecoding"), QStringLiteral("enabled"));
  QVERIFY(codes(validate(QStringLiteral("vf-append=@user-1:hflip\n"), m_rules, context))
              .contains(QStringLiteral("1:vf-hwdec")));
}

void TestMpvConfDocument::suspendsAndRestoresConflictingLines()
{
  const QString text = QStringLiteral(
    "vf-append=@user-1:fps=60\n"
    "vf-append=@user-2:hflip\n"
    "vf-append=@user-3:vapoursynth=file=~~/svp.vpy\n"
    "[tigerest-default]\n"
    "interpolation=yes\n"
    "interpolation=no\n");
  const QVariantMap rifeOn{{QStringLiteral("video.aiRife"), true}};
  const SuspensionResult on = applySuspension(text, m_rules, rifeOn);
  QCOMPARE(on.suspended.size(), 3);
  const QList<Line> lines = parse(on.user);
  QCOMPARE(lines[0].kind, Line::Suspended);
  QCOMPARE(lines[0].reasons, QStringList{QStringLiteral("RIFE")});
  QCOMPARE(lines[1].kind, Line::Option);
  QCOMPARE(lines[2].kind, Line::Suspended);
  QCOMPARE(lines[4].kind, Line::Suspended);
  QCOMPARE(lines[5].kind, Line::Option);
  // Applying again changes nothing.
  QCOMPARE(applySuspension(on.user, m_rules, rifeOn).user, on.user);

  const SuspensionResult off = applySuspension(on.user, m_rules, {{QStringLiteral("video.aiRife"), false}});
  QCOMPARE(off.user, text);
  QCOMPARE(off.restored.size(), 3);
}

void TestMpvConfDocument::neutralizesLockedOptions()
{
  const QString text = QStringLiteral("hwdec=auto\ndeband=no\nprofile=tigerest-default\n[p]\nvf-append=@user-1:hflip\n");
  const LockResult result = neutralizeLocked(text, m_rules, {});
  QCOMPARE(result.ignored.size(), 3);
  const QList<Line> lines = parse(result.user);
  QCOMPARE(lines[0].kind, Line::Ignored);
  QCOMPARE(lines[1].kind, Line::Option);
  QCOMPARE(lines[2].kind, Line::Ignored);
  QCOMPARE(lines[4].kind, Line::Ignored);
  QCOMPARE(neutralizeLocked(result.user, m_rules, {}).user, result.user);
}

void TestMpvConfDocument::editsOptionsInPlace()
{
  const QString edited = setOption(m_default, QStringLiteral("tigerest-liveaction"),
                                   QStringLiteral("deband-threshold"), QStringLiteral("30"));
  // The live-action profile had no own threshold, so exactly one line is added there.
  QCOMPARE(edited.count('\n'), m_default.count('\n') + 1);
  QCOMPARE(resolveValue(parse(edited), QStringLiteral("tigerest-liveaction"), QStringLiteral("deband-threshold")).value,
           QStringLiteral("30"));
  // The other profiles keep their own values.
  QCOMPARE(resolveValue(parse(edited), QStringLiteral("tigerest-default"), QStringLiteral("deband-threshold")).value,
           QStringLiteral("24"));
  const QString again = setOption(edited, QStringLiteral("tigerest-liveaction"),
                                  QStringLiteral("deband-threshold"), QStringLiteral("31"));
  QCOMPARE(again.count('\n'), edited.count('\n'));
  QCOMPARE(removeOption(again, QStringLiteral("tigerest-liveaction"), QStringLiteral("deband-threshold")), m_default);
}

void TestMpvConfDocument::insertsIntoTheRightSection()
{
  const QString empty = QStringLiteral("# 开头注释\n\n# 档位说明\n[p]\nscale=bilinear\n");
  const QString global = setOption(empty, QStringLiteral("default"), QStringLiteral("alang"), QStringLiteral("jpn"),
                                   QStringLiteral("首选音轨语言"));
  const QList<Line> lines = parse(global);
  int alang = -1;
  for (const Line& line : lines)
    if (line.key == QStringLiteral("alang"))
      alang = line.number;
  QVERIFY(alang > 0);
  QCOMPARE(lines[alang - 1].section, QStringLiteral("default"));
  QCOMPARE(lines[alang - 2].raw, QStringLiteral("# 首选音轨语言"));
  const QString created = setOption(empty, QStringLiteral("tigerest-user-night"), QStringLiteral("deband"),
                                    QStringLiteral("no"));
  QVERIFY(created.endsWith(QStringLiteral("[tigerest-user-night]\ndeband=no\n")));
  QCOMPARE(insertLines(QStringLiteral("a=1\nb=2\n"), 1, {QStringLiteral("c=3")}), QStringLiteral("a=1\nc=3\nb=2\n"));
}

void TestMpvConfDocument::resolvesInheritedValues()
{
  const QList<Line> lines = parse(m_default);
  QCOMPARE(resolveValue(lines, QStringLiteral("tigerest-liveaction"), QStringLiteral("deband-threshold")).value,
           QStringLiteral("48"));
  QCOMPARE(resolveValue(lines, QStringLiteral("tigerest-liveaction"), QStringLiteral("deband-threshold")).section,
           QStringLiteral("tigerest-quality-base"));
  QCOMPARE(resolveValue(lines, QStringLiteral("tigerest-default"), QStringLiteral("deband-threshold")).value,
           QStringLiteral("24"));
  QCOMPARE(resolveValue(lines, QStringLiteral("tigerest-default"), QStringLiteral("cache-pause")).value,
           QStringLiteral("yes"));
  QVERIFY(!resolveValue(lines, QStringLiteral("tigerest-default"), QStringLiteral("alang")).found);
}

void TestMpvConfDocument::resolvesProfilesForTheHost()
{
  const QList<Line> lines = parse(m_default);
  const QList<ProfileInfo> infos = profiles(lines);
  QCOMPARE(infos.size(), 4);
  QCOMPARE(infos[1].name, QStringLiteral("tigerest-default"));
  QCOMPARE(infos[1].description, QStringLiteral("默认（Anime AA 高强度）"));
  QString error;
  const QList<ProfileStep> steps = resolveProfile(lines, QStringLiteral("tigerest-default"), &error);
  QVERIFY(error.isEmpty());
  QVERIFY(steps.first().builtin);
  QCOMPARE(steps.first().value, QStringLiteral("high-quality"));
  QCOMPARE(shaderCount(steps), 3);
  QCOMPARE(shaderCount(resolveProfile(lines, QStringLiteral("tigerest-liveaction"))), 2);
  QCOMPARE(shaderCount(resolveProfile(lines, QStringLiteral("tigerest-aggressive-test"))), 4);
  resolveProfile(lines, QStringLiteral("absent"), &error);
  QVERIFY(!error.isEmpty());
  error.clear();
  resolveProfile(parse(QStringLiteral("[a]\nprofile=b\n[b]\nprofile=a\n")), QStringLiteral("a"), &error);
  QVERIFY(error.contains(QStringLiteral("循环")));
}

void TestMpvConfDocument::findsMissingShaders()
{
  const QString text = QStringLiteral("[p]\nglsl-shader=~~/shaders/SSim/SSimDownscaler_RT.glsl\n"
                                      "glsl-shader=~~/shaders/user/gone.glsl\n");
  const QList<ShaderReference> references = shaderReferences(parse(text), m_mpvRoot);
  QCOMPARE(references.size(), 2);
  QVERIFY(QFileInfo(references[0].resolved).isFile());
  ValidationContext context;
  context.configDir = m_mpvRoot;
  QCOMPARE(codes(validate(text, m_rules, context), QStringLiteral("error")), QStringList{QStringLiteral("3:missing-shader")});
}

QTEST_GUILESS_MAIN(TestMpvConfDocument)
#include "test_mpv_conf_document.moc"
