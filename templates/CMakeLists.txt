cmake_minimum_required(VERSION 3.16)
set(CMAKE_TOOLCHAIN_FILE "${CMAKE_SOURCE_DIR}/sys/cmake/toolchain.cmake")
project(MenuColumn LANGUAGES ASM C CXX)
include(config/config.cmake)
set(USE_SAIL FALSE)
add_executable(MenuColumn hoop3_text_hook.cpp hoop3_title_bridge.cpp hoop3_title_entry.S)
include_directories(lib/nnsdk/include)
include(sys/cmake/module.cmake)
target_compile_definitions(LibHakkun PRIVATE HOOP_DX_READ_ONLY_BOOT=1)
target_compile_definitions(MenuColumn PRIVATE HOOP3_TEXT_PATCH_ACTIVE=HOOP3_ACTIVE_MODE)
# The pinned public std archive includes LLVM bitcode. On GitHub's LLVM 19,
# lld crashed in its LTO inliner (ConstantFoldCall), after every C++ object
# compiled. Keep the compile proof at LTO O0 to bypass that optimization path.
# This is a toolchain workaround, NOT a Switch runtime-safety assertion.
target_link_options(MenuColumn PRIVATE -Wl,--undefined=menu_hoop3_title_entry
    -Wl,--undefined=menu_hoop3_instruction_entry -Wl,--lto-O0)
