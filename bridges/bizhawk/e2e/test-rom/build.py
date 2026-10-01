"""Tiny two-pass assembler for this original, fixed NROM fixture (standard library only)."""
import hashlib
from pathlib import Path
import struct
import sys

IMPLIED = {"SEI": 0x78, "CLD": 0xD8, "TXS": 0x9A, "RTI": 0x40}
IMMEDIATE = {"LDX": 0xA2, "LDA": 0xA9}
ABSOLUTE = {"STA": 0x8D, "JMP": 0x4C}


def assemble(source: str) -> bytes:
    labels = {}
    instructions = []
    pc = 0x8000
    for line in source.splitlines():
        line = line.split(";", 1)[0].strip()
        if not line:
            continue
        if line.endswith(":"):
            label = line[:-1]
            if label in labels:
                raise ValueError(f"Duplicate label: {label}")
            labels[label] = pc
            continue
        parts = line.split()
        op = parts[0]
        size = 1 if op in IMPLIED else 2 if op in IMMEDIATE else 3 if op in ABSOLUTE else 0
        if not size or len(parts) != (1 if size == 1 else 2):
            raise ValueError(f"Unsupported instruction: {line}")
        instructions.append(parts)
        pc += size
    code = bytearray()
    for parts in instructions:
        op = parts[0]
        if op in IMPLIED:
            code.append(IMPLIED[op])
        elif op in IMMEDIATE:
            if not parts[1].startswith("#$"):
                raise ValueError("Immediate hexadecimal operand required")
            code.extend((IMMEDIATE[op], int(parts[1][2:], 16)))
        else:
            operand = parts[1]
            address = int(operand[1:], 16) if operand.startswith("$") else labels[operand]
            code.append(ABSOLUTE[op])
            code.extend(struct.pack("<H", address))
    if len(code) > 0x3FFA:
        raise ValueError("Program exceeds NROM bank")
    prg = code + bytes(0x3FFA - len(code))
    prg += struct.pack("<HHH", labels["interrupt"], labels["reset"], labels["interrupt"])
    # iNES: one 16 KiB PRG bank (mirrored), one blank 8 KiB CHR bank, mapper 0.
    return b"NES\x1a" + bytes([1, 1]) + bytes(10) + prg + bytes(8192)


if __name__ == "__main__":
    output = Path(sys.argv[1])
    rom = assemble((Path(__file__).parent / "src/main.asm").read_text(encoding="utf-8"))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(rom)
    print(f"Built {output.name}: {len(rom)} bytes, SHA256 {hashlib.sha256(rom).hexdigest()}")
