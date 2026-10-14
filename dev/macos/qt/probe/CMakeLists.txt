cmake_minimum_required(VERSION 3.21)
project(TigerestFrameProbe LANGUAGES CXX OBJCXX)
set(CMAKE_CXX_STANDARD 17)
find_package(Qt6 6.9 REQUIRED COMPONENTS Quick WebEngineQuick)
add_executable(TigerestFrameProbe MACOSX_BUNDLE main.cpp native_state.mm)
set_target_properties(TigerestFrameProbe PROPERTIES
    MACOSX_BUNDLE_GUI_IDENTIFIER "top.tigerest.frame-probe"
    MACOSX_BUNDLE_BUNDLE_NAME "TigerestFrameProbe")
target_link_libraries(TigerestFrameProbe PRIVATE Qt6::Quick Qt6::WebEngineQuick "-framework AppKit")
