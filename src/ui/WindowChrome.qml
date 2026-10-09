import QtQuick
import QtQuick.Window
import QtQuick.Controls

Item {
  id: chrome
  required property var hostWindow
  property bool videoActive: false
  readonly property bool maximized: hostWindow.visibility === Window.Maximized
  readonly property int barHeight: enabled && hostWindow.visibility !== Window.FullScreen ? 36 : 0
  readonly property int resizeMargin: 5
  readonly property int resizeInset: enabled && hostWindow.visibility === Window.Windowed ? resizeMargin : 0
  visible: barHeight > 0

  function toggleMaximized() {
    if (maximized)
      hostWindow.showNormal()
    else
      hostWindow.showMaximized()
  }

  function restoreForDrag(globalPosition, horizontalRatio, verticalOffset) {
    if (!maximized)
      return
    // Qt maximizes a frameless HWND without Windows' WS_MAXIMIZE state, so
    // SC_DRAGMOVE cannot restore it for us. Keep the pointer over the same
    // proportion of the title bar when restoring the saved window size.
    hostWindow.showNormal()
    hostWindow.x = Math.round(globalPosition.x - hostWindow.width * horizontalRatio)
    hostWindow.y = Math.round(globalPosition.y - verticalOffset)
  }

  Item {
    anchors.fill: parent
    visible: chrome.videoActive && chrome.resizeInset > 0
    Rectangle {
      y: chrome.barHeight
      width: chrome.resizeInset
      height: parent.height - y
      color: "#11151c"
    }
    Rectangle {
      anchors.right: parent.right
      y: chrome.barHeight
      width: chrome.resizeInset
      height: parent.height - y
      color: "#11151c"
    }
    Rectangle {
      anchors.bottom: parent.bottom
      width: parent.width
      height: chrome.resizeInset
      color: "#11151c"
    }
  }

  Rectangle {
    width: parent.width
    height: chrome.barHeight
    gradient: Gradient {
      GradientStop { position: 0; color: "#1b2029" }
      GradientStop { position: 1; color: "#11151c" }
    }

    Image {
      x: 14
      anchors.verticalCenter: parent.verticalCenter
      width: 18
      height: 18
      source: "qrc:/images/icon.png"
      fillMode: Image.PreserveAspectFit
      smooth: true
    }
    Text {
      x: 42
      width: Math.max(0, parent.width - x - windowButtons.width - 16)
      anchors.verticalCenter: parent.verticalCenter
      text: chrome.hostWindow.title
      color: "#d8d9dc"
      font.pixelSize: 12
      font.weight: Font.Medium
      elide: Text.ElideRight
    }
    Rectangle {
      anchors.bottom: parent.bottom
      width: parent.width
      height: 1
      color: "#d7b56d"
      opacity: 0.16
    }

    MouseArea {
      id: dragArea
      objectName: "chromeDragArea"
      width: Math.max(0, parent.width - windowButtons.width)
      height: parent.height
      acceptedButtons: Qt.LeftButton
      property point pressPosition
      property bool moving: false
      onPressed: function(mouse) {
        pressPosition = Qt.point(mouse.x, mouse.y)
        moving = false
      }
      // Start the OS move only after a drag, so a double click remains available.
      onPositionChanged: function(mouse) {
        if (pressed && !moving &&
            Math.hypot(mouse.x - pressPosition.x, mouse.y - pressPosition.y) >= Qt.styleHints.startDragDistance) {
          moving = true
          const globalPosition = dragArea.mapToGlobal(mouse.x, mouse.y)
          chrome.restoreForDrag(globalPosition, pressPosition.x / chrome.hostWindow.width, pressPosition.y)
          chrome.hostWindow.startSystemMove()
        }
      }
      onDoubleClicked: chrome.toggleMaximized()
      onReleased: moving = false
      onCanceled: moving = false
    }

    Row {
      id: windowButtons
      anchors.right: parent.right
      height: parent.height
      WindowButton {
        objectName: "chromeMinimize"
        control: "minimize"
        onClicked: chrome.hostWindow.showMinimized()
      }
      WindowButton {
        objectName: "chromeMaximize"
        control: "maximize"
        onClicked: chrome.toggleMaximized()
      }
      WindowButton {
        objectName: "chromeClose"
        control: "close"
        onClicked: chrome.hostWindow.close()
      }
    }
  }

  component WindowButton: ToolButton {
    id: button
    required property string control
    width: 44
    height: chrome.barHeight
    hoverEnabled: true
    focusPolicy: Qt.TabFocus
    Accessible.name: control === "close" ? qsTr("关闭") :
                     control === "minimize" ? qsTr("最小化") :
                     chrome.maximized ? qsTr("还原") : qsTr("最大化")
    ToolTip.visible: hovered
    ToolTip.delay: 600
    ToolTip.text: Accessible.name
    background: Rectangle {
      color: button.control === "close" && (button.hovered || button.down) ? "#b93243" :
             button.down ? "#3d424d" : button.hovered || button.visualFocus ? "#2d333e" : "transparent"
    }
    contentItem: Item {
      readonly property color ink: button.hovered || button.visualFocus ? "#ffffff" : "#c5c8ce"
      Rectangle {
        anchors.centerIn: parent
        width: 12; height: 1
        color: parent.ink
        visible: button.control === "minimize"
      }
      Rectangle {
        anchors.centerIn: parent
        width: 11; height: 10
        color: "transparent"
        border.width: 1
        border.color: parent.ink
        visible: button.control === "maximize" && !chrome.maximized
      }
      Item {
        anchors.centerIn: parent
        width: 13; height: 12
        visible: button.control === "maximize" && chrome.maximized
        Rectangle {
          x: 3; y: 0; width: 10; height: 9
          color: "transparent"; border.width: 1; border.color: parent.parent.ink
        }
        Rectangle {
          x: 0; y: 3; width: 10; height: 9
          color: "#1b2029"; border.width: 1; border.color: parent.parent.ink
        }
      }
      Rectangle {
        anchors.centerIn: parent
        width: 14; height: 1
        rotation: 45
        color: parent.ink
        visible: button.control === "close"
      }
      Rectangle {
        anchors.centerIn: parent
        width: 14; height: 1
        rotation: -45
        color: parent.ink
        visible: button.control === "close"
      }
    }
  }

  // Native resize keeps the OS's minimum size and monitor/DPI handling.
  Repeater {
    model: [
      { name: "Left", edges: Qt.LeftEdge, left: true, vertical: true, cursor: Qt.SizeHorCursor },
      { name: "Right", edges: Qt.RightEdge, right: true, vertical: true, cursor: Qt.SizeHorCursor },
      { name: "Top", edges: Qt.TopEdge, top: true, horizontal: true, cursor: Qt.SizeVerCursor },
      { name: "Bottom", edges: Qt.BottomEdge, bottom: true, horizontal: true, cursor: Qt.SizeVerCursor },
      { name: "TopLeft", edges: Qt.TopEdge | Qt.LeftEdge, left: true, top: true, cursor: Qt.SizeFDiagCursor },
      { name: "TopRight", edges: Qt.TopEdge | Qt.RightEdge, right: true, top: true, cursor: Qt.SizeBDiagCursor },
      { name: "BottomLeft", edges: Qt.BottomEdge | Qt.LeftEdge, left: true, bottom: true, cursor: Qt.SizeBDiagCursor },
      { name: "BottomRight", edges: Qt.BottomEdge | Qt.RightEdge, right: true, bottom: true, cursor: Qt.SizeFDiagCursor }
    ]
    delegate: MouseArea {
      required property var modelData
      objectName: "chromeResize" + modelData.name
      readonly property int corner: chrome.resizeMargin
      x: modelData.right ? chrome.width - width : modelData.horizontal ? corner : 0
      y: modelData.bottom ? chrome.height - height : modelData.vertical ? corner : 0
      width: modelData.horizontal ? Math.max(0, chrome.width - corner * 2) :
             modelData.vertical ? chrome.resizeMargin : corner
      height: modelData.vertical ? Math.max(0, chrome.height - corner * 2) :
              modelData.horizontal ? chrome.resizeMargin : corner
      enabled: chrome.enabled && chrome.hostWindow.visibility === Window.Windowed
      visible: enabled
      z: 2
      cursorShape: modelData.cursor
      acceptedButtons: Qt.LeftButton
      onPressed: chrome.hostWindow.startSystemResize(modelData.edges)
    }
  }
}
