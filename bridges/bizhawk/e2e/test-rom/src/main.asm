; Original deterministic NROM fixture. Reset at $8000, RAM sentinel at $0300.
; Interrupts and rendering disabled. No BIOS, copyrighted assets or game code.
reset:
    SEI
    CLD
    LDX #$ff
    TXS
    LDA #$00
    STA $2000
    STA $2001
    STA $4010
    LDA #$40
    STA $4017
    LDA #$11
    STA $0300
    LDA #$22
    STA $0301
    LDA #$33
    STA $0302
    LDA #$44
    STA $0303
idle:
    JMP idle
interrupt:
    RTI
