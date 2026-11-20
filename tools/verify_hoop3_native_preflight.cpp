// Host-only native-tick and session-owner check for an ALREADY validated
// timeline.bin extracted from a .groove. Not a ZIP verifier or Switch loader.
#include "groove_hoop3_session_owner.hpp"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <vector>

int main(int argc, char** argv) {
    if (argc != 2) {
        std::cerr << "Usage: verify_hoop3_native_preflight timeline.bin\n";
        return 2;
    }
    std::ifstream input(argv[1], std::ios::binary | std::ios::ate);
    if (!input) {
        std::cerr << "Cannot read timeline.bin\n";
        return 2;
    }
    const auto length = input.tellg();
    if (length < 8 || length > static_cast<std::streamoff>(
            8 + groove_runtime::kMaxEvents * 16)) {
        std::cerr << "Invalid GRT1 size\n";
        return 2;
    }
    input.seekg(0);
    const std::vector<std::uint8_t> bytes{
        std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>()};
    static groove_hoop3::SessionOwner owner;
    if (!owner.load_prevalidated_timeline(bytes.data(), bytes.size())) {
        std::cerr << "Rejected GRT1 command or original 480-tick timebase\n";
        return 1;
    }
    std::cout << "Host preflight passed: " << owner.ring_count()
              << " native ring events. No Switch hooks installed.\n";
    return 0;
}
