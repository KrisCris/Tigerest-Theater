#include <QtTest/QtTest>
#include <QLabel>
#include <QProgressBar>
#include "ui/RifeStartupDialog.h"

class RifeStartupDialogTest : public QObject
{
  Q_OBJECT

private slots:
  void verificationProgressReflectsActualBytes_data()
  {
    QTest::addColumn<qint64>("done");
    QTest::addColumn<qint64>("total");
    QTest::addColumn<int>("percent");
    QTest::newRow("quarter") << qint64(100 * 1024 * 1024) << qint64(400 * 1024 * 1024) << 25;
    QTest::newRow("larger-than-int") << qint64(6LL * 1024 * 1024 * 1024) << qint64(8LL * 1024 * 1024 * 1024) << 75;
    QTest::newRow("round-down") << qint64(999) << qint64(1000) << 99;
    QTest::newRow("bytes-finished-gate-pending") << qint64(1000) << qint64(1000) << 99;
    QTest::newRow("overshoot") << qint64(2000) << qint64(1000) << 99;
  }

  void verificationProgressReflectsActualBytes()
  {
    QFETCH(qint64, done);
    QFETCH(qint64, total);
    QFETCH(int, percent);
    RifeStartupDialog dialog;
    dialog.begin();
    dialog.updateStatus({{"state", "checking"}, {"busy", true}, {"doneBytes", done}, {"totalBytes", total}});
    const auto* progress = dialog.findChild<QProgressBar*>();
    QVERIFY(progress);
    QCOMPARE(progress->maximum(), 100);
    QCOMPARE(progress->value(), percent);
  }

  void missingTotalsRemainIndeterminate()
  {
    RifeStartupDialog dialog;
    dialog.begin();
    dialog.updateStatus({{"state", "checking"}, {"busy", true}, {"doneBytes", 50}, {"totalBytes", 100}});
    dialog.updateStatus({{"state", "checking"}, {"busy", true}, {"doneBytes", 50}});
    const auto* progress = dialog.findChild<QProgressBar*>();
    QVERIFY(progress);
    QCOMPARE(progress->maximum(), 0);
  }

  void runtimeProbeHasItsOwnIndeterminatePhaseAndElapsedTime()
  {
    RifeStartupDialog dialog;
    dialog.begin();
    dialog.updateStatus({{"state", "ready"}, {"busy", false}, {"doneBytes", 100}, {"totalBytes", 100},
        {"runtime", QVariantMap{{"runtimePreparing", true}, {"activated", false}}}});
    const auto* progress = dialog.findChild<QProgressBar*>();
    QVERIFY(progress);
    QCOMPARE(progress->maximum(), 0);
    const auto* stage = dialog.findChild<QLabel*>("rifeStartupStage");
    const auto* detail = dialog.findChild<QLabel*>("rifeStartupDetail");
    QVERIFY(stage);
    QVERIFY(detail);
    QVERIFY(stage->text().contains("NVIDIA"));
    QVERIFY(!detail->text().contains('%'));
    const auto initial = detail->text();
    QTRY_VERIFY_WITH_TIMEOUT(detail->text() != initial, 2000);
  }

  void contentKeepsSharedEdges_data()
  {
    QTest::addColumn<int>("width");
    QTest::newRow("compact") << 360;
    QTest::newRow("wide") << 600;
  }

  void contentKeepsSharedEdges()
  {
    QFETCH(int, width);
    RifeStartupDialog dialog;
    dialog.begin();
    dialog.resize(width, dialog.sizeHint().height());
    dialog.show();
    QCoreApplication::processEvents();
    const auto* stage = dialog.findChild<QLabel*>("rifeStartupStage");
    const auto* detail = dialog.findChild<QLabel*>("rifeStartupDetail");
    const auto* progress = dialog.findChild<QProgressBar*>();
    QVERIFY(stage);
    QVERIFY(detail);
    QVERIFY(progress);
    QCOMPARE(progress->geometry().left(), stage->geometry().left());
    QCOMPARE(progress->geometry().right(), stage->geometry().right());
    QCOMPARE(progress->geometry().left(), detail->geometry().left());
    QCOMPARE(progress->geometry().right(), detail->geometry().right());
    QVERIFY(progress->geometry().top() > stage->geometry().bottom());
    QVERIFY(detail->geometry().top() > progress->geometry().bottom());
    QCOMPARE(progress->geometry().left(), dialog.width() - progress->geometry().right() - 1);
    QVERIFY(progress->width() > dialog.width() * 0.75);
  }

  void fastCompletionNeverShowsOrReopensTheDialog()
  {
    RifeStartupDialog dialog;
    dialog.begin();
    QVERIFY(!dialog.isVisible());
    dialog.finish();
    dialog.updateStatus({{"state", "checking"}, {"busy", true}});
    QTest::qWait(450);
    QVERIFY(!dialog.isVisible());
  }

  void closingOrEscapeCannotDismissAnUnfinishedGate()
  {
    RifeStartupDialog dialog;
    QSignalSpy rejected(&dialog, &QDialog::rejected);
    dialog.begin();
    dialog.show();
    dialog.close();
    QVERIFY(dialog.isVisible());
    QTest::keyClick(&dialog, Qt::Key_Escape);
    QVERIFY(dialog.isVisible());
    QVERIFY(rejected.isEmpty());
    dialog.finish();
    QVERIFY(!dialog.isVisible());
  }
};

QTEST_MAIN(RifeStartupDialogTest)
#include "test_rife_startup_dialog.moc"
