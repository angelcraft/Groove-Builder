// GE-151 dormant ARM64 entries. Capture the *incoming* LR before C++/Hakkun.
// Integer/pointer arguments only, at most x0..x7; no sret/stack/FP signatures.
// AAPCS64: 80-byte frame, SP stays 16-byte aligned. Original x30 at +64.
.macro ENTRY name, number
.section .text.\name,"axR",%progbits
.global \name
.type \name,%function
\name:
    sub sp,sp,#80
    stp x0,x1,[sp,#0]
    stp x2,x3,[sp,#16]
    stp x4,x5,[sp,#32]
    stp x6,x7,[sp,#48]
    str x30,[sp,#64]
    mov x0,#\number
    mov x1,sp
    bl groove_v0_dispatch
    ldr x30,[sp,#64]
    add sp,sp,#80
    ret
.size \name,.-\name
.endm
ENTRY groove_v0_map_init_entry,0
ENTRY groove_v0_map_dtor_entry,1
ENTRY groove_v0_confirm_entry,2
ENTRY groove_v0_map_cell_entry,3
ENTRY groove_v0_reverse_entry,4
ENTRY groove_v0_cell_state_entry,5
ENTRY groove_v0_save_state_entry,6
ENTRY groove_v0_launch_entry,7
ENTRY groove_v0_begin_play_entry,8
ENTRY groove_v0_campaign_a_entry,9
ENTRY groove_v0_campaign_b_entry,10
ENTRY groove_v0_set_sel_entry,11
ENTRY groove_v0_get_sel_entry,12
ENTRY groove_v0_init_gameplay_entry,13
ENTRY groove_v0_commit_entry,14
ENTRY groove_v0_map_return_entry,15
ENTRY groove_v0_write_save_entry,16
ENTRY groove_v0_perfect_site_entry,17
ENTRY groove_v0_perfect_ctor_entry,18
.section .note.GNU-stack,"",%progbits
