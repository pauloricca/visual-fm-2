/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef TEIA_FM1_UPLOAD_H
#define TEIA_FM1_UPLOAD_H
#include "runtime.h"
#define TEIA_LEGACY_HEADER_BYTES 116u
#define TEIA_HEADER_BYTES 187u
#define TEIA_PACKAGE_MAX (TEIA_HEADER_BYTES + TEIA_MAX_OPS * TEIA_OP_BYTES + TEIA_MAX_VALUES * 4u)
_Static_assert(TEIA_PACKAGE_MAX < 16384u, "Package exceeds 14-bit transport offsets");
_Static_assert(TEIA_MAX_VALUES <= 256u, "Parameter indices are one byte");
typedef struct { uint8_t value; char label[12]; int32_t min, max, step; } teia_knob_t;
typedef struct {
    teia_program_t program;
    char name[24];
    uint8_t version;
    uint8_t params[5]; /* level, frequency, gate, attack, release */
    uint8_t knob_count;
    teia_knob_t knobs[6];
    uint8_t valid;
} teia_patch_t;
typedef struct {
    teia_patch_t bank[3];
    teia_patch_t *slots[2], *spare;
    uint8_t bytes[TEIA_PACKAGE_MAX];
    uint32_t total, received, crc;
    uint8_t receiving, target;
    volatile uint32_t pending, destination, active;
} teia_upload_t;
static uint32_t teia_rd16(const uint8_t *p) { return p[0] | (uint32_t)p[1] << 8; }
static uint32_t teia_rd32(const uint8_t *p) { return teia_rd16(p) | teia_rd16(p + 2) << 16; }
static int32_t teia_signed(uint32_t n) { return n <= 0x7fffffffu ? (int32_t)n : -1 - (int32_t)(~n); }
static uint32_t teia_crc(const uint8_t *p, uint32_t n)
{
    uint32_t c = 0xffffffffu, i;
    while (n--) { c ^= *p++; for (i = 0; i < 8; ++i) c = (c >> 1) ^ (0xedb88320u & (0u - (c & 1u))); }
    return ~c;
}
static int teia_text(char *out, const uint8_t *p, uint32_t n, int label)
{
    uint32_t i; int ended = 0;
    if (!p[0]) return 0;
    for (i = 0; i < n; ++i) {
        uint8_t c = p[i];
        if (!c) ended = 1;
        else if (ended || c < 32 || c > 126 || (label && c != ' ' && (c < 'a' || c > 'z'))) return 0;
        out[i] = (char)c;
    }
    return ended;
}
static int teia_decode(teia_patch_t *p, const uint8_t *b, uint32_t n)
{
    uint32_t i, j, at, header, version, stride;
    p->valid = 0;
    if (n < 12 || b[0] != 'T' || b[1] != 'G' || b[2] != 'P' || b[3] != '1') return 0;
    version = teia_rd16(b+4);
    if (version < 1 || version > TEIA_PACKAGE_VERSION) return 0;
    header = version >= 4 ? TEIA_HEADER_BYTES : TEIA_LEGACY_HEADER_BYTES;
    stride = version < 3 ? 12u : TEIA_OP_BYTES;
    p->program.count = teia_rd16(b+6); p->program.registers = teia_rd16(b+8); p->program.value_count = teia_rd16(b+10);
    if (!p->program.count || p->program.count > TEIA_MAX_OPS || !p->program.registers || p->program.registers > TEIA_MAX_REGS || p->program.value_count > TEIA_MAX_VALUES ||
        n != header + p->program.count * stride + p->program.value_count * 4) return 0;
    if (!teia_text(p->name, b+12, 24, 0)) return 0;
    p->version = (uint8_t)version;
    p->knob_count = version >= 4 ? b[36] : 3;
    if (p->knob_count > 6) return 0;
    if (version < 4) for (i = 0; i < 5; ++i) {
        p->params[i] = b[36+i];
        if (p->params[i] >= p->program.value_count) return 0;
        for (j = 0; j < i; ++j) if (p->params[j] == p->params[i]) return 0;
    }
    for (i = 0; i < p->knob_count; ++i) {
        teia_knob_t *k = &p->knobs[i]; const uint8_t *v = b + (version >= 4 ? 37 : 41) + 25*i;
        k->value = v[0];
        if (k->value >= p->program.value_count || !teia_text(k->label, v+1, 12, 1)) return 0;
        for (j = 0; j < i; ++j) if (p->knobs[j].value == k->value) return 0;
        k->min = teia_signed(teia_rd32(v+13)); k->max = teia_signed(teia_rd32(v+17)); k->step = teia_signed(teia_rd32(v+21));
        if (k->min >= k->max || k->step <= 0 || (int64_t)k->step > (int64_t)k->max - k->min) return 0;
    }
    at = header;
    for (i = 0; i < p->program.count; ++i) {
        teia_op_t *o = &p->program.ops[i];
        /* Explicit fields: no dependence on struct padding, alignment or endianness. */
        o->code = (int16_t)teia_rd16(b+at); o->out = (int16_t)teia_rd16(b+at+2);
        o->a = (int16_t)teia_rd16(b+at+4); o->b = (int16_t)teia_rd16(b+at+6);
        o->c = (int16_t)teia_rd16(b+at+8); o->state = (int16_t)teia_rd16(b+at+10); 
        o->d = o->e = o->f = o->g = o->h = o->i = 0;
        if (version >= 3) {
            o->d=(int16_t)teia_rd16(b+at+12); o->e=(int16_t)teia_rd16(b+at+14);
            o->f=(int16_t)teia_rd16(b+at+16); o->g=(int16_t)teia_rd16(b+at+18);
            o->h=(int16_t)teia_rd16(b+at+20); o->i=(int16_t)teia_rd16(b+at+22);
        } else if (o->code > 20) return 0;
        at += stride;
    }
    for (i = 0; i < TEIA_MAX_VALUES; ++i) p->program.values[i] = i < p->program.value_count ? teia_signed(teia_rd32(b+at+4*i)) : 0;
    if (version < 4 && (p->program.values[p->params[0]] < 0 || p->program.values[p->params[0]] > TEIA_Q / 2 || p->program.values[p->params[2]] != 0)) return 0;
    for (i = 0; i < p->knob_count; ++i) {
        teia_knob_t *k = &p->knobs[i]; int32_t v = p->program.values[k->value];
        if (v < k->min || v > k->max) return 0;
        if (version < 4 && k->value == p->params[0] && (k->min < 0 || k->max > TEIA_Q / 2)) return 0;
    }
    if (version == 1) {
        if (p->program.count > 64 || p->program.registers > 64 || p->program.value_count > 64) return 0;
        for (i = 0; i < p->program.count; ++i)
            if (p->program.ops[i].code == 20 || ((p->program.ops[i].code == 3 || p->program.ops[i].code == 19) && p->program.ops[i].state >= 16)) return 0;
    }
    if (!teia_validate(&p->program)) return 0;
    p->valid = 1; return 1;
}
static void teia_upload_init(teia_upload_t *u)
{
    uint32_t i;
    for (i = 0; i < 3; ++i) u->bank[i].valid = 0;
    u->slots[0] = &u->bank[0]; u->slots[1] = &u->bank[1]; u->spare = &u->bank[2];
    u->pending = u->active = u->received = u->receiving = 0;
}
/* Status: 0 ok, 1 bad command/length, 2 transfer/order, 3 CRC, 4 invalid graph,
 * 5 audio switch busy. Commit/select success is acknowledged only after apply. */
static uint8_t teia_request(teia_upload_t *u, uint8_t cmd, const uint8_t *b, uint32_t n)
{
    uint32_t i, off;
    if (cmd == 0 || cmd == 5) return n ? 1 : 0;
    if (u->pending) return 5;
    if (cmd == 1) {
        if (n != 7 || b[0] > 1 || teia_rd16(b+1) < 116 || teia_rd16(b+1) > TEIA_PACKAGE_MAX) return 1;
        u->target = b[0]; u->total = teia_rd16(b+1); u->crc = teia_rd32(b+3);
        u->received = 0; u->receiving = 1; return 0;
    }
    if (cmd == 2) {
        if (!u->receiving || n < 3 || n > 98) return 2;
        off = teia_rd16(b); n -= 2;
        if (off != u->received || n > u->total - u->received) return 2;
        for (i = 0; i < n; ++i) u->bytes[u->received+i] = b[2+i];
        u->received += n; return 0;
    }
    if (cmd == 3) {
        if (n || !u->receiving || u->received != u->total) return 2;
        u->receiving = 0;
        if (teia_crc(u->bytes, u->total) != u->crc) return 3;
        if (!teia_decode(u->spare, u->bytes, u->total)) return 4;
        u->destination = u->target;
        __asm__ volatile("" ::: "memory"); u->pending = 1; return 0;
    }
    if (cmd == 4) {
        if (n != 1 || b[0] > 1) return 1;
        u->destination = b[0];
        __asm__ volatile("" ::: "memory"); u->pending = 2; return 0;
    }
    return 1;
}
/* Called only by the audio ISR between buffers, after fading the previous buffer. */
static void teia_apply(teia_upload_t *u, teia_runtime_t *r)
{
    teia_patch_t *p;
    if (!u->pending) return;
    if (u->pending == 1) { p = u->slots[u->destination]; u->slots[u->destination] = u->spare; u->spare = p; }
    u->active = u->destination; p = u->slots[u->active];
    if (p->valid) (void)teia_load(r, &p->program); else r->program = 0;
    __asm__ volatile("" ::: "memory"); u->pending = 0;
}
#endif
