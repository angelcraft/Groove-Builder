// GE-151 interim (Grok): H-B2 entry. Captures the INCOMING x30 (return address in the game, expected
// main+0x50A060) before any C++ prologue, then tail-branches so the C++ handler returns straight to the game.
// bool groove_b2_destroy_entry(SceneMgr* mgr)  ->  bool groove_b2_destroy_pending(SceneMgr* mgr, uintptr_t lr)
.section .text.groove_b2_destroy_entry,"axR",%progbits
.global groove_b2_destroy_entry
.type groove_b2_destroy_entry,%function
groove_b2_destroy_entry:
    mov x1, x30
    b groove_b2_destroy_pending
.size groove_b2_destroy_entry,.-groove_b2_destroy_entry
.section .note.GNU-stack,"",%progbits
