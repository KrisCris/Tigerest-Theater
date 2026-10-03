#pragma once

#include <QDialog>
#include <QElapsedTimer>
#include <QTimer>
#include <QVariantMap>

class QLabel;
class QProgressBar;

// Kept separate from player startup so the waiting UI can be exercised without
// creating mpv or loading a GPU runtime.
class RifeStartupDialog : public QDialog
{
public:
  explicit RifeStartupDialog(QWidget* parent = nullptr);
  void begin();
  void updateStatus(const QVariantMap& status);
  void finish();

protected:
  void reject() override;
  void closeEvent(QCloseEvent* event) override;
  void showEvent(QShowEvent* event) override;

private:
  void updateDetail();

  QLabel* m_stage;
  QLabel* m_detail;
  QProgressBar* m_progress;
  QTimer m_showTimer;
  QTimer m_elapsedTimer;
  QElapsedTimer m_elapsed;
  QString m_detailText;
  bool m_finished = false;
};
