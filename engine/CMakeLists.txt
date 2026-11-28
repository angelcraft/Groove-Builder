cmake_minimum_required(VERSION 3.16)
set(CMAKE_TOOLCHAIN_FILE "${CMAKE_SOURCE_DIR}/sys/cmake/toolchain.cmake")
project(GrooveHT3 LANGUAGES ASM C CXX)
include(config/config.cmake)
add_executable(GrooveHT3 src/main.cpp src/timeline.cpp src/multi.cpp src/gtf.cpp src/v0_native.cpp src/v0_loader.cpp src/v0_entries.S)
include_directories(lib/nnsdk/include src)
include(sys/cmake/module.cmake)
# sail not used in v0.1.1 (no imports at all)

# LLVM 19 lld LTO crash workaround (same as repo PR #1); toolchain only.
target_link_options(GrooveHT3 PRIVATE -Wl,--lto-O0)
