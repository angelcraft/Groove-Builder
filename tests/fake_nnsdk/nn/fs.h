#pragma once

// ORIGINAL TEST FIXTURE, NOT Nintendo SDK code.
// Only the seven small type/symbol surfaces needed by the read-only bridge
// are emulated for compilation on Linux. Real target ABI must still be
// checked against the Hakkun-provided SDK headers before hardware use.

#include <cstddef>
#include <cstdint>

namespace nn {

struct Result {
    std::uint32_t value;
};

namespace fs {

struct FileHandle {
    std::uint64_t _internal;
};

enum OpenMode : int {
    OpenMode_Read = 1,
};

Result OpenFile(FileHandle*, const char*, int);
Result GetFileSize(std::int64_t*, FileHandle);
Result ReadFile(std::size_t*, FileHandle, std::int64_t, void*, std::size_t);
void CloseFile(FileHandle);

} // namespace fs
} // namespace nn
