#include "RifeStartupDialog.h"

#include <QCloseEvent>
#include <QLabel>
#include <QLocale>
#include <QProgressBar>
#include <QVBoxLayout>

#ifdef Q_OS_WIN
#include <QLibrary>
#include <windows.h>
#endif

RifeStartupDialog::RifeStartupDialog(QWidget* parent)
  : QDialog(parent), m_stage(new QLabel(this)), m_detail(new QLabel(this)),
    m_progress(new QProgressBar(this))
{
  setObjectName(QStringLiteral("rifeStartupDialog"));
  setWindowTitle(QStringLiteral("大河影院"));
  setWindowFlags(Qt::Dialog | Qt::CustomizeWindowHint | Qt::WindowTitleHint);
  setWindowModality(Qt::ApplicationModal);
  setMinimumWidth(360);
  setStyleSheet(QStringLiteral(
      "QDialog#rifeStartupDialog { background: #11141b; }"
      "QLabel { color: #f0f2f7; background: transparent; }"
      "QLabel#rifeStartupBrand { color: #ffbe38; }"
      "QLabel#rifeStartupDetail { color: #aab2c2; }"
      "QProgressBar { background: #2b3240; border: none; border-radius: 4px; }"
      "QProgressBar::chunk { background: #ffbe38; border-radius: 4px; }"));

  auto* layout = new QVBoxLayout(this);
  layout->setContentsMargins(24, 24, 24, 24);
  layout->setSpacing(12);
  auto* brand = new QLabel(QStringLiteral("大河影院 · 补帧启动"), this);
  brand->setObjectName(QStringLiteral("rifeStartupBrand"));
  layout->addWidget(brand);

  m_stage->setObjectName(QStringLiteral("rifeStartupStage"));
  m_stage->setWordWrap(true);
  auto stageFont = font();
  stageFont.setBold(true);
  stageFont.setPointSizeF(stageFont.pointSizeF() + 2);
  m_stage->setFont(stageFont);
  layout->addWidget(m_stage);

  m_progress->setObjectName(QStringLiteral("rifeStartupProgress"));
  m_progress->setTextVisible(false);
  m_progress->setFixedHeight(8);
  m_progress->setSizePolicy(QSizePolicy::Expanding, QSizePolicy::Fixed);
  m_progress->setAccessibleName(QStringLiteral("RIFE 启动进度"));
  layout->addWidget(m_progress);

  m_detail->setObjectName(QStringLiteral("rifeStartupDetail"));
  m_detail->setWordWrap(true);
  layout->addWidget(m_detail);

  m_showTimer.setSingleShot(true);
  m_showTimer.setInterval(350);
  connect(&m_showTimer, &QTimer::timeout, this, [this] {
    if (!m_finished) show();
  });
  m_elapsedTimer.setInterval(250);
  connect(&m_elapsedTimer, &QTimer::timeout, this, &RifeStartupDialog::updateDetail);
  updateStatus({});
  resize(420, sizeHint().height());
}

void RifeStartupDialog::begin()
{
  if (m_finished || m_elapsed.isValid()) return;
  m_elapsed.start();
  m_showTimer.start();
  m_elapsedTimer.start();
  updateDetail();
}

void RifeStartupDialog::updateStatus(const QVariantMap& status)
{
  if (m_finished) return;
  const auto runtime = status.value(QStringLiteral("runtime")).toMap();
  const bool probing = runtime.value(QStringLiteral("runtimePreparing")).toBool();
  if (probing)
  {
    m_stage->setText(QStringLiteral("2 / 2 · 检查 NVIDIA 补帧运行库"));
    m_progress->setRange(0, 0);
    m_detailText = QStringLiteral("扩展文件核验通过，正在确认运行环境");
  }
  else
  {
    m_stage->setText(QStringLiteral("1 / 2 · 核验 RIFE 扩展"));
    bool doneValid = false;
    bool totalValid = false;
    const qint64 done = status.value(QStringLiteral("doneBytes")).toLongLong(&doneValid);
    const qint64 total = status.value(QStringLiteral("totalBytes")).toLongLong(&totalValid);
    if (doneValid && totalValid && done >= 0 && total > 0)
    {
      // Byte verification is only the first phase. Never round to 100% while
      // final verification and the runtime activation gate are still pending.
      const int percent = qMin(99, int(100.0L * qMin(done, total) / total));
      m_progress->setRange(0, 100);
      m_progress->setValue(percent);
      const auto locale = QLocale();
      m_detailText = QStringLiteral("已核验 %1 / %2 · %3%")
          .arg(locale.formattedDataSize(qMin(done, total)), locale.formattedDataSize(total))
          .arg(percent);
    }
    else
    {
      m_progress->setRange(0, 0);
      m_detailText = QStringLiteral("正在读取扩展文件，请稍候");
    }
  }
  updateDetail();
}

void RifeStartupDialog::updateDetail()
{
  const qint64 seconds = m_elapsed.isValid() ? m_elapsed.elapsed() / 1000 : 0;
  m_detail->setText(QStringLiteral("%1\n已用时 %2 秒").arg(m_detailText).arg(seconds));
}

void RifeStartupDialog::finish()
{
  m_finished = true;
  m_showTimer.stop();
  m_elapsedTimer.stop();
  hide();
}

void RifeStartupDialog::reject()
{
  // Escape must not dismiss this window and leave a headless startup behind.
  // Only PlayerComponent's completed gate can proceed to QML/mpv creation.
  if (m_finished) QDialog::reject();
}

void RifeStartupDialog::closeEvent(QCloseEvent* event)
{
  if (m_finished) QDialog::closeEvent(event);
  else event->ignore();
}

void RifeStartupDialog::showEvent(QShowEvent* event)
{
  QDialog::showEvent(event);
#ifdef Q_OS_WIN
  // Match the main window's title bar without linking to a GPU/QML window.
  using SetAttribute = HRESULT (WINAPI *)(HWND, DWORD, LPCVOID, DWORD);
  static const auto setAttribute = reinterpret_cast<SetAttribute>(
      QLibrary::resolve(QStringLiteral("dwmapi"), "DwmSetWindowAttribute"));
  if (!setAttribute) return;
  const auto handle = reinterpret_cast<HWND>(winId());
  const BOOL dark = TRUE;
  if (FAILED(setAttribute(handle, 20, &dark, sizeof(dark))))
    setAttribute(handle, 19, &dark, sizeof(dark));
  const COLORREF caption = RGB(17, 20, 27);
  const COLORREF text = RGB(240, 242, 247);
  setAttribute(handle, 35, &caption, sizeof(caption));
  setAttribute(handle, 36, &text, sizeof(text));
#endif
}
