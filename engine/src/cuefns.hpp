// Generated from the remix call survey (own analysis). Cue functions the engine may call
// as fn(scene, thread, a, b, c, d). Only addresses + first two instruction words (checked at boot).
#pragma once
#include <cstdint>
namespace groove {
constexpr int kGameNames = 24;
static const char* const kGameName[kGameNames] = {"PUMPUP", "FLYDISC", "ROLLING", "HUNGRY", "CARS", "KAERU", "CRAB", "INSECT", "SOFTCATCH", "RING", "THUNDER", "HAMMER", "MOON", "THE_A", "PUTILABO", "WIPER", "SOCCER", "HURDLE", "TALK", "COOKING", "PARASOL", "DANCER", "SAMURAI", "BRUSH"};
// kind 0: fn(scene, thread, int a, int b, int c, int d)
// kind 1: fn(scene, thread, const char* word, 0, 0, float 1.0)  (A for Effort: word from kTheAWords)
struct CueFn { uint8_t game; uint32_t off; uint32_t w0, w1; uint8_t kind = 0; };
static const char* const kTheAWords[] = {"TEA", "SODA", "COCOA", "AAA"};
constexpr int kTheAWordCount = 4;
static const CueFn kCueFns[] = {
    {0, 0x209B80, 0xD10303FF, 0xA9067BFD},  // PUMPUP
    {0, 0x20A170, 0xD10303FF, 0xA9067BFD},  // PUMPUP
    {1, 0x18D3F0, 0xD10343FF, 0xA9077BFD},  // FLYDISC (x5 = d, native 0)
    {2, 0x222FA0, 0xD10303FF, 0xA9067BFD},  // ROLLING
    {2, 0x223350, 0xD10303FF, 0xA9067BFD},  // ROLLING
    {2, 0x223800, 0xD102C3FF, 0xA9067BFD},  // ROLLING
    {3, 0x1AF800, 0xD102C3FF, 0xA9057BFD},  // HUNGRY
    {4, 0x1601D0, 0xD102C3FF, 0xA9057BFD},  // CARS
    {4, 0x1608F0, 0xD102C3FF, 0xA9057BFD},  // CARS
    {5, 0x1B8DB0, 0xD103C3FF, 0xA90A7BFD},  // KAERU
    {5, 0x1B8F70, 0xD103C3FF, 0xA90A7BFD},  // KAERU
    {6, 0x17BFC0, 0xD10303FF, 0xA9067BFD},  // CRAB
    {6, 0x17D0D0, 0xD10303FF, 0xA9067BFD},  // CRAB
    {7, 0x1B54C0, 0xD10303FF, 0xA9067BFD},  // INSECT
    {7, 0x1B5A60, 0xD10303FF, 0xA9067BFD},  // INSECT
    {7, 0x1B60F0, 0xD10303FF, 0xA9067BFD},  // INSECT
    {8, 0x248B70, 0xD10383FF, 0xA9087BFD},  // SOFTCATCH
    {9, 0x217960, 0xD102C3FF, 0xA9057BFD},  // RING
    {10, 0x27DBA0, 0xD10303FF, 0xA9067BFD},  // THUNDER
    {10, 0x27E130, 0xD10303FF, 0xA9067BFD},  // THUNDER
    {10, 0x27E6C0, 0xD10303FF, 0xA9067BFD},  // THUNDER
    {10, 0x27EC00, 0xD10303FF, 0xA9067BFD},  // THUNDER
    {11, 0x1AB410, 0xD10343FF, 0xA9077BFD},  // HAMMER
    {11, 0x1ABCB0, 0xD10343FF, 0xA9077BFD},  // HAMMER
    {12, 0x1DB630, 0xD10303FF, 0xA9067BFD},  // MOON
    {13, 0x278FE0, 0xD10483FF, 0xFD005BE8, 1},  // THE_A (word + float)
    {14, 0x20BF90, 0xD10343FF, 0xA9077BFD},  // PUTILABO
    {14, 0x20C190, 0xD10343FF, 0xA9077BFD},  // PUTILABO
    {15, 0x2AA2F0, 0xD10303FF, 0xA9067BFD},  // WIPER
    {15, 0x2A9B00, 0xD10303FF, 0xA9067BFD},  // WIPER
    {15, 0x2AA6F0, 0xD10303FF, 0xA9067BFD},  // WIPER
    {15, 0x2AA4F0, 0xD10303FF, 0xA9067BFD},  // WIPER
    {15, 0x2A9900, 0xD10303FF, 0xA9067BFD},  // WIPER
    {15, 0x2A9700, 0xD10303FF, 0xA9067BFD},  // WIPER
    {16, 0x246760, 0xD10303FF, 0xA9067BFD},  // SOCCER
    {16, 0x246B80, 0xD10303FF, 0xA9067BFD},  // SOCCER
    {16, 0x246FF0, 0xD10303FF, 0xA9067BFD},  // SOCCER
    {17, 0x1B1FC0, 0xD102C3FF, 0xA9057BFD},  // HURDLE
    {17, 0x1B24D0, 0xA9BC7BFD, 0xA9015FF8},  // HURDLE
    {18, 0x255100, 0xD102C3FF, 0xA9057BFD},  // TALK
    {19, 0x178880, 0xD10343FF, 0xA9077BFD},  // COOKING
    {19, 0x178DC0, 0xD10343FF, 0xA9077BFD},  // COOKING broccoli (x5 = d, native -1)
    {20, 0x204970, 0xD10343FF, 0xA9077BFD},  // PARASOL cho/pa (x5 = d, native 0)
    {20, 0x205030, 0xD10343FF, 0xA9077BFD},  // PARASOL
    {21, 0x181210, 0xD10343FF, 0xA9077BFD},  // DANCER
    {21, 0x181C70, 0xD10343FF, 0xA9077BFD},  // DANCER elbow (x5 = d, native 0)
    {21, 0x182460, 0xD10343FF, 0xA9077BFD},  // DANCER
    {22, 0x22AD50, 0xFC1D0FE8, 0xA900FBFD},  // SAMURAI
    {22, 0x22AFF0, 0xFC1D0FE8, 0xA900FBFD},  // SAMURAI
    {23, 0x15AF40, 0xD10343FF, 0xA9077BFD},  // BRUSH
    {23, 0x15B2E0, 0xD10343FF, 0xA9077BFD},  // BRUSH
    {23, 0x15AB00, 0xD10343FF, 0xA9077BFD},  // BRUSH
    {23, 0x15A560, 0xD10343FF, 0xA9077BFD},  // BRUSH sweeping (x5 = d, native 0)
};
constexpr int kCueFnCount = sizeof(kCueFns) / sizeof(kCueFns[0]);
} // namespace groove
