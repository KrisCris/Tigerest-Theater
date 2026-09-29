add_library(tigerest_rife SHARED RifeEngine.mm RifeEngine.h RifeTypes.h RifeMetalWarp.mm RifeMetalWarp.h)
target_include_directories(tigerest_rife PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(tigerest_rife PUBLIC cxx_std_17)
target_compile_options(tigerest_rife PRIVATE -fobjc-arc)
target_link_libraries(tigerest_rife PRIVATE "-framework Foundation" "-framework CoreML" "-framework Metal")
set_target_properties(tigerest_rife PROPERTIES OUTPUT_NAME "tigerest-rife")

# Actual inference tests are enabled only with explicitly prepared fixtures.
# The application never fetches models or runs Python for inference.
set(RIFE_TEST_MODEL_ROOT "" CACHE PATH "Prepared RIFE model directories for native integration tests")

find_package(PkgConfig REQUIRED)
pkg_check_modules(RIFE_VS REQUIRED vapoursynth>=79)
add_library(tigerest_rife_vs MODULE RifeVsPlugin.cpp FrameTiming.cpp FrameTiming.h)
target_compile_features(tigerest_rife_vs PRIVATE cxx_std_17)
target_include_directories(tigerest_rife_vs PRIVATE ${RIFE_VS_INCLUDE_DIRS})
target_link_libraries(tigerest_rife_vs PRIVATE tigerest_rife)
set_target_properties(tigerest_rife_vs PROPERTIES PREFIX "" OUTPUT_NAME "tigerest-rife-vs" SUFFIX ".dylib")
