// HOST diagnostic of the complete *initial Hoop3-only* metadata contract.
// This is not an SD loader, a generic adapter validator, or a Switch hook.
// Compile on Linux with -lz. The portable core has NO dependency on zlib.

#include "groove_hoop3_archive_loader.hpp"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>

#include <zlib.h>

static bool read_file(void* context, std::uint64_t offset, void* output,
                      std::size_t bytes) {
    auto& file = *static_cast<std::ifstream*>(context);
    if (offset > static_cast<std::uint64_t>(
            std::numeric_limits<std::streamoff>::max()) ||
        bytes > static_cast<std::size_t>(
            std::numeric_limits<std::streamsize>::max())) return false;
    file.clear();
    file.seekg(static_cast<std::streamoff>(offset), std::ios::beg);
    if (!file) return false;
    file.read(static_cast<char*>(output), static_cast<std::streamsize>(bytes));
    return file.gcount() == static_cast<std::streamsize>(bytes);
}

static bool inflate_raw(void*, const std::uint8_t* compressed,
                        std::size_t compressed_size, std::uint8_t* output,
                        std::size_t expected_size) {
    if (compressed_size > std::numeric_limits<uInt>::max() ||
        expected_size > std::numeric_limits<uInt>::max()) return false;
    z_stream z{};
    z.next_in = const_cast<Bytef*>(compressed);
    z.avail_in = static_cast<uInt>(compressed_size);
    z.next_out = output;
    z.avail_out = static_cast<uInt>(expected_size);
    if (::inflateInit2(&z, -MAX_WBITS) != Z_OK) return false;
    const auto code = ::inflate(&z, Z_FINISH);
    const bool success = code == Z_STREAM_END &&
                         z.total_in == compressed_size &&
                         z.total_out == expected_size;
    ::inflateEnd(&z);
    return success;
}

int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "Usage: verify_hoop3_zip_container FILE.groove\n";
        return 2;
    }
    std::ifstream file(argv[1], std::ios::binary | std::ios::ate);
    if (!file || file.tellg() < 0) {
        std::cerr << "Cannot open .groove\n";
        return 1;
    }
    const std::uint64_t size = static_cast<std::uint64_t>(file.tellg());
    static groove_hoop3::SessionOwner owner;
    static groove_hoop3::ArchiveLoader loader;
    const groove_zip::Reader source{read_file, &file, size};
    const auto result = loader.load(owner, source, inflate_raw, nullptr);
    if (result.status != groove_hoop3::ArchiveLoadStatus::loaded) {
        if (result.status == groove_hoop3::ArchiveLoadStatus::json_cache_mismatch)
            std::cerr << "Hoop3 manifest or editable JSON differs from GRT1 cache\n";
        else
            std::cerr << "Hoop3 archive rejected (status " <<
                static_cast<unsigned>(result.status) << ")\n";
        return 1;
    }
    std::cout << "Hoop3 ZIP CRC, exact manifest, full JSON/cache match and "
              << result.events << " native events passed. Host SessionOwner "
              << (owner.hoop3_slot_unlocked() ? "ready" : "blocked")
              << "; Switch menu/SD/ARM64 NOT connected.\n";
}
