cmake_minimum_required(VERSION 3.10...3.31)

set(CMAKE_AUTOMOC ON)

find_package(Qt6 ${REQUIRED_QT_VERSION} REQUIRED COMPONENTS Test)

set(TEST_INCLUDE_DIRS
  ${CMAKE_SOURCE_DIR}/src
  ${CMAKE_SOURCE_DIR}/src/core
  ${CMAKE_SOURCE_DIR}/src/shared
  ${CMAKE_SOURCE_DIR}/external
  ${CMAKE_SOURCE_DIR}/src/player
)

set(TEST_COMPILE_DEFS
  PREFIX="${CMAKE_INSTALL_PREFIX}"
  SOURCE_ROOT="${CMAKE_SOURCE_DIR}"
)

add_executable(test_systemcomponent test_systemcomponent.cpp)
target_link_libraries(test_systemcomponent jmp_core Qt6::Test)
target_include_directories(test_systemcomponent PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_systemcomponent PRIVATE ${TEST_COMPILE_DEFS})
file(GLOB TEST_SYSTEMCOMPONENT_NATIVE_SCRIPTS CONFIGURE_DEPENDS
  "${CMAKE_SOURCE_DIR}/native/*.js"
)
qt_add_resources(test_systemcomponent "test_systemcomponent_native_scripts"
  PREFIX "/web-client/extension"
  BASE "${CMAKE_SOURCE_DIR}/native"
  FILES ${TEST_SYSTEMCOMPONENT_NATIVE_SCRIPTS}
)
add_test(NAME test_systemcomponent COMMAND test_systemcomponent)

add_executable(test_log test_log.cpp)
target_link_libraries(test_log jmp_core Qt6::Test)
target_include_directories(test_log PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_log PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_log COMMAND test_log)

add_executable(test_settings test_settings.cpp)
target_link_libraries(test_settings jmp_core Qt6::Test)
target_include_directories(test_settings PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_settings PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_settings COMMAND test_settings)

add_executable(test_displaymanager test_displaymanager.cpp)
target_link_libraries(test_displaymanager jmp_core Qt6::Test)
target_include_directories(test_displaymanager PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_displaymanager PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_displaymanager COMMAND test_displaymanager)

add_executable(test_windowmanager test_windowmanager.cpp)
target_link_libraries(test_windowmanager jmp_core Qt6::Test)
target_include_directories(test_windowmanager PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_windowmanager PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_windowmanager COMMAND test_windowmanager)
if(APPLE)
  # Native macOS maximize/fullscreen transitions are asynchronous and can be
  # rejected for an inactive test process. Exercise WindowManager's state
  # transitions deterministically without depending on the desktop session.
  set_tests_properties(test_windowmanager PROPERTIES
    ENVIRONMENT "QT_QPA_PLATFORM=offscreen")
endif()

add_executable(test_playback_identity test_playback_identity.cpp)
target_link_libraries(test_playback_identity jmp_core Qt6::Test)
target_include_directories(test_playback_identity PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_playback_identity PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_playback_identity COMMAND test_playback_identity)

add_executable(test_danmaku_metadata test_danmaku_metadata.cpp)
target_link_libraries(test_danmaku_metadata jmp_core Qt6::Test)
target_include_directories(test_danmaku_metadata PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_danmaku_metadata PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_danmaku_metadata COMMAND test_danmaku_metadata)

add_executable(test_danmaku_style_config test_danmaku_style_config.cpp)
target_link_libraries(test_danmaku_style_config jmp_core Qt6::Test)
target_include_directories(test_danmaku_style_config PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_danmaku_style_config PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_danmaku_style_config COMMAND test_danmaku_style_config)

add_executable(test_mpv_console test_mpv_console.cpp)
target_link_libraries(test_mpv_console jmp_core Qt6::Test)
target_include_directories(test_mpv_console PRIVATE ${TEST_INCLUDE_DIRS})
target_compile_definitions(test_mpv_console PRIVATE ${TEST_COMPILE_DEFS})
add_test(NAME test_mpv_console COMMAND test_mpv_console)

find_package(Python3 COMPONENTS Interpreter QUIET)
if(APPLE)
  add_executable(test_rife_timing test_rife_timing.cpp ../src/player/interpolation/FrameTiming.cpp)
  foreach(case policy controller)
    add_executable(test_rife_${case} test_rife_${case}.cpp)
    target_link_libraries(test_rife_${case} PRIVATE tigerest_rife_control)
    add_test(NAME test_rife_${case} COMMAND test_rife_${case})
  endforeach()
  target_compile_features(test_rife_timing PRIVATE cxx_std_17)
  target_include_directories(test_rife_timing PRIVATE ../src/player/interpolation)
  add_test(NAME test_rife_timing COMMAND test_rife_timing)
  set(RIFE_TEST_VS_PYTHON "" CACHE FILEPATH "Python interpreter with the test VapourSynth runtime")
  set(RIFE_TEST_MPV "" CACHE FILEPATH "EOF-aware mpv binary for RIFE integration tests")
  set(RIFE_TEST_VSSCRIPT_LIB "" CACHE FILEPATH "VSScript runtime for native mpv integration tests")
  if(RIFE_TEST_MODEL_ROOT AND RIFE_TEST_VS_PYTHON)
    set(RIFE_TEST_ENV "RIFE_VS_PLUGIN=$<TARGET_FILE:tigerest_rife_vs>;RIFE_SMALL_MODEL=${RIFE_TEST_MODEL_ROOT}/128-fp32")
    foreach(case vapoursynth vpy)
      add_test(NAME test_rife_${case} COMMAND "${RIFE_TEST_VS_PYTHON}" "${CMAKE_CURRENT_SOURCE_DIR}/test_rife_${case}.py")
      set_tests_properties(test_rife_${case} PROPERTIES ENVIRONMENT "${RIFE_TEST_ENV}" TIMEOUT 120 RUN_SERIAL TRUE LABELS "rife-stream")
    endforeach()
    if(RIFE_TEST_MPV AND RIFE_TEST_VSSCRIPT_LIB AND Python3_Interpreter_FOUND)
      add_executable(test_rife_controller_live test_rife_controller_live.cpp)
      target_include_directories(test_rife_controller_live PRIVATE ../src/player ${MPV_INCLUDE_DIR})
      target_link_libraries(test_rife_controller_live PRIVATE tigerest_rife_control ${MPV_LIBRARY})
      add_test(NAME test_rife_controller_live COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/test_rife_controller_live.py" $<TARGET_FILE:test_rife_controller_live>)
      set_tests_properties(test_rife_controller_live PROPERTIES
        ENVIRONMENT "${RIFE_TEST_ENV};VSSCRIPT_PATH=${RIFE_TEST_VSSCRIPT_LIB}"
        TIMEOUT 60 RUN_SERIAL TRUE LABELS "rife-stream")
      foreach(case mpv_eof streaming stream_lifecycle uosc)
        add_test(NAME test_rife_${case} COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/test_rife_${case}.py")
        set_tests_properties(test_rife_${case} PROPERTIES
          ENVIRONMENT "${RIFE_TEST_ENV};RIFE_MPV_BINARY=${RIFE_TEST_MPV};VSSCRIPT_PATH=${RIFE_TEST_VSSCRIPT_LIB}"
          TIMEOUT 120 RUN_SERIAL TRUE LABELS "rife-stream")
      endforeach()
    endif()
  endif()
  add_executable(test_rife_engine test_rife_engine.mm)
  target_compile_options(test_rife_engine PRIVATE -fobjc-arc)
  target_link_libraries(test_rife_engine PRIVATE tigerest_rife)
  add_executable(test_rife_split_engine test_rife_split_engine.mm)
  target_compile_options(test_rife_split_engine PRIVATE -fobjc-arc)
  target_link_libraries(test_rife_split_engine PRIVATE tigerest_rife)
  add_executable(test_rife_metal_warp test_rife_metal_warp.mm)
  target_compile_options(test_rife_metal_warp PRIVATE -fobjc-arc)
  target_link_libraries(test_rife_metal_warp PRIVATE tigerest_rife "-framework Foundation" "-framework CoreML")
  add_test(NAME test_rife_metal_warp COMMAND test_rife_metal_warp)
  set_tests_properties(test_rife_metal_warp PROPERTIES TIMEOUT 60 RUN_SERIAL TRUE LABELS "rife-metal")
  if(RIFE_TEST_MODEL_ROOT)
    add_executable(test_rife_coarse_metal test_rife_coarse_metal.mm)
    target_compile_options(test_rife_coarse_metal PRIVATE -fobjc-arc)
    target_link_libraries(test_rife_coarse_metal PRIVATE tigerest_rife "-framework Foundation" "-framework CoreML")
    if(EXISTS "${RIFE_TEST_MODEL_ROOT}/192-coarse-stages/coarse-fixture")
      add_test(NAME test_rife_coarse_metal COMMAND test_rife_coarse_metal
        "${RIFE_TEST_MODEL_ROOT}/192-coarse-stages/coarse-fixture")
      set_tests_properties(test_rife_coarse_metal PROPERTIES TIMEOUT 60 RUN_SERIAL TRUE LABELS "rife-metal")
    endif()
    add_test(NAME test_rife_engine COMMAND test_rife_engine
      "${RIFE_TEST_MODEL_ROOT}/1080-grid-half-fp32" "${RIFE_TEST_MODEL_ROOT}/128-fp32")
    set_tests_properties(test_rife_engine PROPERTIES TIMEOUT 120 RUN_SERIAL TRUE LABELS "rife-model")
    if(EXISTS "${RIFE_TEST_MODEL_ROOT}/1080-split-refine/manifest.json")
      add_test(NAME test_rife_split_engine COMMAND test_rife_split_engine
        "${RIFE_TEST_MODEL_ROOT}/1080-split-refine")
      set_tests_properties(test_rife_split_engine PROPERTIES TIMEOUT 120 RUN_SERIAL TRUE LABELS "rife-model")
      add_test(NAME test_rife_split_metal COMMAND test_rife_split_engine
        "${RIFE_TEST_MODEL_ROOT}/1080-split-refine" --metal)
      set_tests_properties(test_rife_split_metal PROPERTIES TIMEOUT 120 RUN_SERIAL TRUE LABELS "rife-model")
      if(EXISTS "${RIFE_TEST_MODEL_ROOT}/1080-split-refine/Stage0.mlpackage")
        add_test(NAME test_rife_coarse_engine COMMAND test_rife_split_engine
          "${RIFE_TEST_MODEL_ROOT}/1080-split-refine" --coarse)
        set_tests_properties(test_rife_coarse_engine PROPERTIES TIMEOUT 120 RUN_SERIAL TRUE LABELS "rife-model")
      endif()
    endif()
  endif()
  add_executable(test_mpv_svp test_mpv_svp.cpp)
  target_link_libraries(test_mpv_svp jmp_core Qt6::Test)
  target_include_directories(test_mpv_svp PRIVATE ${TEST_INCLUDE_DIRS})
  target_compile_definitions(test_mpv_svp PRIVATE ${TEST_COMPILE_DEFS})
  qt_add_resources(test_mpv_svp "test_mpv_svp_resources"
    PREFIX "/"
    BASE "${CMAKE_SOURCE_DIR}/resources"
    FILES "${CMAKE_SOURCE_DIR}/resources/mpv/mpv.conf.in"
          "${CMAKE_SOURCE_DIR}/resources/settings/settings_description.json")
  add_test(NAME test_mpv_svp COMMAND test_mpv_svp)
  add_executable(test_macos_pause test_macos_pause.mm)
  target_link_libraries(test_macos_pause jmp_core Qt6::Test "-framework AppKit")
  target_include_directories(test_macos_pause PRIVATE ${TEST_INCLUDE_DIRS})
  target_compile_definitions(test_macos_pause PRIVATE ${TEST_COMPILE_DEFS})
  option(ENABLE_MACOS_NATIVE_INPUT_TEST "Run input smoke test using a real macvk window and desktop" OFF)
  if(ENABLE_MACOS_NATIVE_INPUT_TEST)
    add_test(NAME test_macos_pause COMMAND test_macos_pause)
    set_tests_properties(test_macos_pause PROPERTIES TIMEOUT 45 RUN_SERIAL TRUE LABELS "macos-native")
  endif()
endif()

if(Python3_Interpreter_FOUND)
  add_test(NAME test_bundle_integrity
           COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test_bundle_integrity.py)
endif()

find_program(Node_EXECUTABLE node)
if(Node_EXECUTABLE)
  add_test(NAME test_server_onboarding
           COMMAND ${Node_EXECUTABLE} --test ${CMAKE_CURRENT_SOURCE_DIR}/test_server_onboarding.js)
  execute_process(COMMAND ${Node_EXECUTABLE} -p "typeof WebSocket === 'function' && typeof fetch === 'function'"
                  OUTPUT_VARIABLE NODE_HAS_WEBENGINE_TEST_APIS OUTPUT_STRIP_TRAILING_WHITESPACE)
  if(WIN32 AND NODE_HAS_WEBENGINE_TEST_APIS STREQUAL "true")
    add_test(NAME test_webengine_startup
             COMMAND ${Node_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test_webengine_startup.js
                     $<TARGET_FILE:${MAIN_TARGET}>)
    set_tests_properties(test_webengine_startup PROPERTIES TIMEOUT 90 RUN_SERIAL TRUE)
    add_test(NAME test_server_onboarding_webengine
             COMMAND ${Node_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test_server_onboarding_webengine.js
                     $<TARGET_FILE:${MAIN_TARGET}>)
    set_tests_properties(test_server_onboarding_webengine PROPERTIES TIMEOUT 90 RUN_SERIAL TRUE)
  endif()
  add_test(NAME test_player_lifecycle
           COMMAND ${Node_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test_player_lifecycle.js)
  add_test(NAME test_stream_quality
           COMMAND ${Node_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test_stream_quality.js)
  add_test(NAME test_session_navigation
           COMMAND ${Node_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test_session_navigation.js)
  add_test(NAME test_web_appearance
           COMMAND ${Node_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/test_web_appearance.js)
endif()
