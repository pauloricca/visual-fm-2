/* SPDX-License-Identifier: GPL-3.0-only */
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "runtime.h"

int main(void)
{
    teia_runtime_t r = {0};
    teia_program_t bad;
    int32_t l, right;
    uint32_t i, crossings = 0;
    int32_t previous = 0;
    double max_error = 0, energy = 0;
    teia_sample(&r, &l, &right); assert(l == 0 && right == 0);
    assert(teia_load(&r, &demo_program));
    for (i = 0; i < 1000; ++i) { teia_sample(&r, &l, &right); assert(l == 0 && right == 0); }
    assert(teia_load(&r, &demo_program));
    r.midi_frequency = 220 * TEIA_Q; r.midi_gate = TEIA_Q;
    for (i = 0; i < TEIA_FS; ++i) {
        double duration = floor((double)demo_program.values[PARAM_ATTACK] * TEIA_FS / TEIA_Q);
        double envelope = fmin((i + 1) / duration, 1.0);
        double expected = sin(2 * 3.141592653589793 * 220 * i / TEIA_FS) * envelope * ((double)demo_program.values[PARAM_LEVEL] / TEIA_Q);
        teia_sample(&r, &l, &right); assert(l == right);
        double error = fabs((double)l / TEIA_Q - expected);
        if (error > max_error) max_error = error;
        if (previous <= 0 && l > 0) ++crossings;
        previous = l; energy += (double)l * l;
        assert(l >= -TEIA_Q && l <= TEIA_Q);
    }
    assert(crossings == 220); assert(max_error < 0.0002); assert(energy > 1e10);
    r.values[PARAM_LEVEL] = 0;
    for (i = 0; i < 100; ++i) { teia_sample(&r, &l, &right); assert(l == 0 && right == 0); }
    r.values[PARAM_LEVEL] = demo_program.values[PARAM_LEVEL];
    r.midi_gate = 0;
    for (i = 0; i < TEIA_FS / 2; ++i) {
        teia_sample(&r, &l, &right);
        if (i > TEIA_FS / 4) assert(l == 0 && right == 0);
    }
    /* Maximum duration must not overflow fixed-point interpolation. */
    assert(teia_load(&r, &demo_program));
    r.values[PARAM_ATTACK] = 2 * TEIA_Q; r.midi_gate = TEIA_Q;
    for (i = 0; i < 2 * TEIA_FS; ++i) {
        teia_sample(&r, &l, &right);
        assert(r.state[0].level >= 0 && r.state[0].level <= TEIA_Q);
    }
    assert(r.state[0].level == TEIA_Q);
    /* Retrigger during release starts from the present level, not zero. */
    r.values[PARAM_RELEASE] = 2 * TEIA_Q; r.midi_gate = 0;
    for (i = 0; i < TEIA_FS; ++i) teia_sample(&r, &l, &right);
    int32_t halfway = r.state[0].level;
    assert(abs(halfway - TEIA_Q / 2) <= 2);
    r.midi_gate = TEIA_Q; teia_sample(&r, &l, &right);
    assert(r.state[0].level >= halfway && r.state[0].level - halfway < 4);
    /* Bounds and opcode rejection must preserve the current loaded program. */
    bad = demo_program; bad.count = TEIA_MAX_OPS + 1; assert(!teia_load(&r, &bad));
    bad = demo_program; bad.ops[0].code = 999; assert(!teia_load(&r, &bad));
    bad = demo_program; bad.ops[0].a = demo_program.value_count; assert(!teia_load(&r, &bad));
    bad = demo_program; bad.ops[0].out = demo_program.registers; assert(!teia_load(&r, &bad));
    for (i = 0; i < demo_program.count; ++i) if (demo_program.ops[i].code == 26) {
        bad = demo_program; bad.ops[i].state = TEIA_MAX_STATES; assert(!teia_load(&r, &bad));
    }
    assert(r.program == &demo_program);
    assert(teia_mul(2147483647, 2147483647) == 2147483647);
    printf("PASS: silence, 220 Hz, stereo, envelope/retrigger, 2 s bounds, rejection, saturation; maximum analytic error %.8f; runtime %zu bytes\n", max_error, sizeof r);
    return 0;
}
