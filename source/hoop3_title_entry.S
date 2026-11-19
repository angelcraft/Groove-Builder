// AArch64 *candidate only*: replace a BL callsite with BL to this entry
// after validating branch reach, original opcode, Scene lifetime, and backend.
// The original 0x1D0204 call sets x0=kind, x1=index and has panel in x19.
// The tail branch leaves original LR intact for the C++ routine's return.
.text
.balign 4
.global menu_hoop3_title_entry
.type menu_hoop3_title_entry, %function
menu_hoop3_title_entry:
    mov x2, x19
    b menu_hoop3_title_dispatch_entry

// Separate native instruction message call at main+0x1D0240:
// x0=bank, x1=resource label, x2=context. x19 remains the menu panel.
.balign 4
.global menu_hoop3_instruction_entry
.type menu_hoop3_instruction_entry, %function
menu_hoop3_instruction_entry:
    mov x3, x19
    b menu_hoop3_instruction_dispatch_entry
