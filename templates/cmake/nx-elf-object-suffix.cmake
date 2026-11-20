# CMake loads this after its language modules. SYSTEM_NAME NX is not a
# known platform and is not UNIX, so those modules would name ELF
# relocatable objects *.obj. The isolated reader audit and the CI
# checker both look up *.cpp.o. This does not link the object anywhere.
set(CMAKE_C_OUTPUT_EXTENSION .o)
set(CMAKE_CXX_OUTPUT_EXTENSION .o)
set(CMAKE_ASM_OUTPUT_EXTENSION .o)
