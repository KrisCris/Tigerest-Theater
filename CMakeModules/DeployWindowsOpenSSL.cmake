# Configure and install share the release-pinned TLS preflight. Do not accept
# OpenSSL from PATH: those DLLs may disappear on a user's machine.
function(tigerest_validate_openssl runtime qt_root lock_file)
  if(NOT IS_DIRECTORY "${runtime}")
    message(FATAL_ERROR "Set TIGEREST_OPENSSL_RUNTIME_DIR to the verified Windows TLS runtime (see dev/windows/tls/README.md)")
  endif()
  file(READ "${lock_file}" tls_lock)
  string(JSON tls_schema GET "${tls_lock}" schemaVersion)
  if(NOT tls_schema EQUAL 1)
    message(FATAL_ERROR "Unsupported Windows OpenSSL runtime lock")
  endif()
  foreach(name libssl-3-x64.dll libcrypto-3-x64.dll libcrypto-3.dll LICENSE.OpenSSL.txt LICENSE.Python.txt)
    if(NOT EXISTS "${runtime}/${name}" OR IS_SYMLINK "${runtime}/${name}")
      message(FATAL_ERROR "Verified OpenSSL file is missing: ${name}")
    endif()
    string(JSON expected_hash GET "${tls_lock}" files "${name}" sha256)
    string(JSON expected_size GET "${tls_lock}" files "${name}" size)
    file(SHA256 "${runtime}/${name}" actual_hash)
    file(SIZE "${runtime}/${name}" actual_size)
    if(NOT actual_hash STREQUAL expected_hash OR NOT actual_size EQUAL expected_size)
      message(FATAL_ERROR "Verified OpenSSL checksum/size mismatch: ${name}")
    endif()
  endforeach()
  if(NOT EXISTS "${qt_root}/plugins/tls/qopensslbackend.dll")
    message(FATAL_ERROR "Matching Qt OpenSSL backend is missing: ${qt_root}/plugins/tls/qopensslbackend.dll")
  endif()
endfunction()

function(tigerest_deploy_openssl runtime qt_root lock_file install_dir)
  # Revalidate all inputs before writing any TLS output.
  tigerest_validate_openssl("${runtime}" "${qt_root}" "${lock_file}")
  set(sources "${runtime}/libssl-3-x64.dll" "${runtime}/libcrypto-3-x64.dll" "${runtime}/libcrypto-3.dll"
              "${runtime}/LICENSE.OpenSSL.txt" "${runtime}/LICENSE.Python.txt"
              "${qt_root}/plugins/tls/qopensslbackend.dll" "${lock_file}")
  set(destinations "${install_dir}/libssl-3-x64.dll" "${install_dir}/libcrypto-3-x64.dll" "${install_dir}/libcrypto-3.dll"
                   "${install_dir}/licenses/openssl/LICENSE.OpenSSL.txt"
                   "${install_dir}/licenses/openssl/LICENSE.Python.txt"
                   "${install_dir}/tls/qopensslbackend.dll"
                   "${install_dir}/licenses/openssl/runtime-lock.json")
  list(LENGTH sources count)
  math(EXPR last "${count} - 1")
  foreach(index RANGE ${last})
    list(GET sources ${index} source)
    list(GET destinations ${index} destination)
    get_filename_component(directory "${destination}" DIRECTORY)
    file(MAKE_DIRECTORY "${directory}")
    execute_process(COMMAND "${CMAKE_COMMAND}" -E copy "${source}" "${destination}"
                    RESULT_VARIABLE copy_result)
    if(NOT copy_result EQUAL 0)
      message(FATAL_ERROR "Failed to deploy verified OpenSSL: ${destination}")
    endif()
    file(SHA256 "${source}" source_hash)
    file(SHA256 "${destination}" deployed_hash)
    if(NOT deployed_hash STREQUAL source_hash)
      message(FATAL_ERROR "Deployed OpenSSL checksum mismatch: ${destination}")
    endif()
  endforeach()
  # Detect source replacement during deployment as well.
  tigerest_validate_openssl("${runtime}" "${qt_root}" "${lock_file}")
  message(STATUS "Deployed verified OpenSSL DLLs and matching Qt TLS backend")
endfunction()
