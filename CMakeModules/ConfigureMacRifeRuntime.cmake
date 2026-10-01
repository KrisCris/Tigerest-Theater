if(CMAKE_VERSION VERSION_LESS "3.19")
  message(FATAL_ERROR "Pinned macOS R79 runtime configuration requires CMake 3.19 or newer")
endif()
if(NOT TIGEREST_VAPOURSYNTH_PYTHON)
  message(FATAL_ERROR "An explicit R79 interpreter is required for pinned headers")
endif()
execute_process(
  COMMAND "${TIGEREST_VAPOURSYNTH_PYTHON}" -B -I -X utf8
          "${CMAKE_SOURCE_DIR}/dev/macos/rife/vapoursynth_runtime.py"
  OUTPUT_VARIABLE rife_runtime_info
  ERROR_VARIABLE rife_runtime_error
  RESULT_VARIABLE rife_runtime_result
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
if(NOT rife_runtime_result EQUAL 0)
  message(FATAL_ERROR "Unable to inspect the explicit R79 runtime: ${rife_runtime_error}")
endif()
# Normal variables override stale pkg-config cache entries from Homebrew R80.
string(JSON RIFE_VS_INCLUDE_DIRS GET "${rife_runtime_info}" include)
set(RIFE_VS_VERSION "79")
message(STATUS "Using pinned R79 plugin headers: ${RIFE_VS_INCLUDE_DIRS}")
