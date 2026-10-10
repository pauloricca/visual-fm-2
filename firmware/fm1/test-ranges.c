/* SPDX-License-Identifier: GPL-3.0-only */
#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include "runtime.h"
int main(void)
{
    /* Endpoints, centre, inverted/equal ranges, and the widest signed span. */
    const int32_t ranges[][2]={{0,TEIA_Q},{-TEIA_Q,TEIA_Q},{TEIA_Q,-TEIA_Q},{123,123},{INT_MIN,INT_MAX},{INT_MAX,INT_MIN}};
    for (unsigned k=0;k<sizeof ranges/sizeof ranges[0];++k) {
        int32_t lo=ranges[k][0],hi=ranges[k][1];
        assert(teia_range(-TEIA_Q,lo,hi)==lo); assert(teia_range(TEIA_Q,lo,hi)==hi);
        for (int32_t x=-TEIA_Q;x<=TEIA_Q;x+=17) {
            int32_t v=teia_range(x,lo,hi);
            assert(v>=(lo<hi?lo:hi) && v<=(lo>hi?lo:hi));
        }
    }
    teia_program_t p={.count=5,.registers=4,.value_count=3,
        .ops={{0,0,0,0,0,0,0,0,0,0,0,0},{0,1,1,0,0,0,0,0,0,0,0,0},{0,2,2,0,0,0,0,0,0,0,0,0},{20,3,0,1,2,0,0,0,0,0,0,0},{5,0,3,0,0,0,0,0,0,0,0,0}},
        .values={440*TEIA_Q,0,TEIA_Q}};
    teia_runtime_t r={0}; int32_t l,right,minimum=TEIA_Q,maximum=0;
    assert(teia_load(&r,&p));
    for (unsigned i=0;i<TEIA_FS;i++) {
        teia_sample(&r,&l,&right); assert(l>=0 && l<=TEIA_Q && right==0);
        if(l<minimum)minimum=l; if(l>maximum)maximum=l;
    }
    assert(minimum<10 && maximum>TEIA_Q-10);
    r.values[1]=TEIA_Q/4; r.values[2]=TEIA_Q/4;
    teia_sample(&r,&l,&right); assert(l==TEIA_Q/4); /* Live range values, no reload. */
    teia_program_t bad=p; bad.ops[3].b=4; assert(!teia_validate(&bad));
    bad=p; bad.ops[3].c=3; assert(!teia_validate(&bad)); /* uninitialized */
    bad=p; bad.ops[3].state=TEIA_MAX_STATES; assert(!teia_validate(&bad));
    p.count=TEIA_MAX_OPS; p.registers=TEIA_MAX_REGS; p.value_count=TEIA_MAX_VALUES;
    for (unsigned i=0;i<TEIA_MAX_OPS-1;i++) p.ops[i]=(teia_op_t){0,(int16_t)i,(int16_t)(i%TEIA_MAX_VALUES),0,0,0,0,0,0,0,0,0};
    p.ops[TEIA_MAX_OPS-1]=(teia_op_t){5,0,TEIA_MAX_REGS-2,0,0,0,0,0,0,0,0,0};
    assert(teia_load(&r,&p)); teia_sample(&r,&l,&right);
    p.count++; assert(!teia_validate(&p)); p.count--;
    p.registers++; assert(!teia_validate(&p)); p.registers--;
    p.value_count++; assert(!teia_validate(&p));
    printf("PASS: oscillator ranges, live endpoints, full signed span, invalid operands and capacity bounds; runtime %zu bytes\n",sizeof r);
}
