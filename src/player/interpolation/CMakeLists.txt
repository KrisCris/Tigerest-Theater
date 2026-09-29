add_library(tigerest_rife SHARED RifeEngine.mm RifeEngine.h RifeTypes.h RifeMetalWarp.mm RifeMetalWarp.h)
target_include_directories(tigerest_rife PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_features(tigerest_rife PUBLIC cxx_std_17)
target_compile_options(tigerest_rife PRIVATE -fobjc-arc)
target_link_libraries(tigerest_rife PRIVATE "-framework Foundation" "-framework CoreML" "-framework Metal")
set_target_properties(tigerest_rife PROPERTIES OUTPUT_NAME "tigerest-rife")

# Actual inference tests are enabled only with explicitly prepared fixtures.
# The application never fetches models or runs Python for inference.
set(RIFE_TEST_MODEL_ROOT "" CACHE PATH "Prepared RIFE model directories for native integration tests")
