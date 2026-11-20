// Candidate ONLY for native main+0x1D3384. x0=kind, x1=index, x19=Scene.
// x19 is copied from the original launch entry and remains unmodified at the
// callsite. Tail-branch preserves the original return address in x30.
.text
.balign 4
.global menu_hoop3_intro_entry
.type menu_hoop3_intro_entry, %function
menu_hoop3_intro_entry:
    mov x2, x19
    b menu_hoop3_intro_dispatch_entry
