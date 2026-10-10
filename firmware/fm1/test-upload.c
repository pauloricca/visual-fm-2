/* SPDX-License-Identifier: GPL-3.0-only */
#include <assert.h>
#include <stdio.h>
#include <math.h>
#include <string.h>
#include "upload.h"
static uint8_t bytes[TEIA_PACKAGE_MAX], other[TEIA_PACKAGE_MAX];
static void put16(uint8_t *b, uint32_t n) { b[0]=(uint8_t)n; b[1]=(uint8_t)(n>>8); }
static void begin(teia_upload_t *u, uint32_t slot, uint32_t n, uint32_t crc)
{
    uint8_t b[7]; b[0]=(uint8_t)slot; put16(b+1,n); put16(b+3,crc); put16(b+5,crc>>16);
    assert(teia_request(u,1,b,7)==0);
}
static void transfer(teia_upload_t *u, const uint8_t *b, uint32_t n)
{
    uint32_t at=0;
    while (at<n) { uint8_t chunk[98]; uint32_t k=n-at > 96 ? 96 : n-at;
        put16(chunk,at); memcpy(chunk+2,b+at,k); assert(teia_request(u,2,chunk,k+2)==0); at+=k;
    }
}
static uint32_t read_package(const char *path, uint8_t *b)
{
    FILE *f=fopen(path,"rb"); assert(f); uint32_t n=(uint32_t)fread(b,1,TEIA_PACKAGE_MAX,f);
    assert(!ferror(f) && fgetc(f)==EOF); fclose(f); return n;
}
static uint32_t crossings(teia_upload_t *u, teia_runtime_t *r)
{
    teia_patch_t *p=u->slots[u->active]; uint32_t count=0; int32_t last=0,l,right;
    r->values[p->params[1]]=220*TEIA_Q; r->values[p->params[2]]=TEIA_Q;
    for (uint32_t i=0;i<TEIA_FS;i++) { teia_sample(r,&l,&right); assert(l==right); if (last<=0 && l>0) ++count; last=l; }
    return count;
}
int main(int argc, char **argv)
{
    assert(argc==5); teia_upload_t u={0}; teia_runtime_t r={0}; int32_t l,right;
    uint32_t n=read_package(argv[1],bytes), m=read_package(argv[2],other);
    teia_upload_init(&u); teia_sample(&r,&l,&right); assert(l==0 && right==0);
    assert(teia_request(&u,3,0,0)==2);
    begin(&u,0,n,teia_crc(bytes,n));
    assert(teia_request(&u,3,0,0)==2); /* incomplete transfer */
    uint8_t bad_offset[3]={1,0,42}; assert(teia_request(&u,2,bad_offset,3)==2); assert(u.received==0);
    transfer(&u,bytes,n); assert(teia_request(&u,3,0,0)==0);
    assert(!r.program && !u.slots[0]->valid); /* queued, not active yet */
    assert(teia_request(&u,4,(uint8_t[]){1},1)==5);
    teia_apply(&u,&r); assert(u.slots[0]->valid && r.program==&u.slots[0]->program);
    assert(crossings(&u,&r)==220);
    const teia_program_t *playing=r.program;
    begin(&u,0,n,teia_crc(bytes,n)^1); transfer(&u,bytes,n);
    assert(teia_request(&u,3,0,0)==3); assert(r.program==playing && !u.pending);
    /* Whole-package CRC passes, but opcode validation must preserve the old patch. */
    uint8_t original=bytes[116]; bytes[116]=99;
    begin(&u,0,n,teia_crc(bytes,n)); transfer(&u,bytes,n);
    assert(teia_request(&u,3,0,0)==4); assert(r.program==playing && !u.pending); bytes[116]=original;
    /* Truncation, unknown version and malformed knob metadata. */
    for (uint32_t i=0;i<n;i++) assert(!teia_decode(u.spare,bytes,i));
    original=bytes[4]; bytes[4]=9; assert(!teia_decode(u.spare,bytes,n)); bytes[4]=original;
    original=bytes[41]; bytes[41]=255; assert(!teia_decode(u.spare,bytes,n)); bytes[41]=original;
    original=bytes[42]; bytes[42]='A'; assert(!teia_decode(u.spare,bytes,n)); bytes[42]=original;
    /* Slot two is a separate graph: its link weight doubles the MIDI frequency. */
    begin(&u,1,m,teia_crc(other,m)); transfer(&u,other,m); assert(teia_request(&u,3,0,0)==0);
    assert(r.program==playing); teia_apply(&u,&r); assert(u.active==1 && crossings(&u,&r)==440);
    assert(teia_request(&u,4,(uint8_t[]){0},1)==0); teia_apply(&u,&r);
    assert(r.program==playing && crossings(&u,&r)==220);
    /* Replacing the active slot swaps banks; previous storage becomes the staging bank. */
    begin(&u,0,m,teia_crc(other,m)); transfer(&u,other,m); assert(teia_request(&u,3,0,0)==0);
    assert(r.program==playing); teia_apply(&u,&r); assert(r.program!=playing && crossings(&u,&r)==440);
    assert(teia_request(&u,0,0,0)==0); assert(teia_request(&u,88,0,0)==1);
    teia_upload_init(&u); r.program=0; assert(!u.slots[0]->valid && !u.slots[1]->valid);
    assert(teia_request(&u,4,(uint8_t[]){1},1)==0); teia_apply(&u,&r); teia_sample(&r,&l,&right); assert(l==0 && right==0);
    /* Existing v1 packages retain their original bipolar oscillator semantics. */
    n=read_package(argv[3],bytes); assert(teia_decode(u.spare,bytes,n));
    assert(teia_load(&r,&u.spare->program));
    /* The user's two-oscillator graph used to exceed both 64-element arrays. */
    n=read_package(argv[4],bytes); assert(teia_decode(u.spare,bytes,n));
    teia_patch_t *patch=u.spare;
    assert(patch->program.count==68 && patch->program.registers==66);
    assert(teia_load(&r,&patch->program));
    r.values[patch->params[1]]=220*TEIA_Q; r.values[patch->params[2]]=TEIA_Q;
    double error=0, mod_hz=220.0*round(0.02*TEIA_Q)/TEIA_Q;
    double gain=0.5*(round(0.85*TEIA_Q)/TEIA_Q)*(round(0.8*TEIA_Q)/TEIA_Q);
    double attack=floor((double)patch->program.values[patch->params[3]]*TEIA_FS/TEIA_Q);
    for(uint32_t i=0;i<TEIA_FS;++i) {
        teia_sample(&r,&l,&right); assert(l==right);
        double expected=sin(2*3.141592653589793*220*i/TEIA_FS)
            *(1+sin(2*3.141592653589793*mod_hz*i/TEIA_FS))*0.5*gain*fmin((i+1)/attack,1);
        double e=fabs((double)l/TEIA_Q-expected); if(e>error)error=e;
    }
    assert(error<0.0002);
    printf("PASS: legacy package and actual ranged tremolo graph; analytic error %.8f\n",error);
    puts("PASS: empty slots, 220/440 Hz compiled graphs, two slots, atomic replace, CRC/bounds/opcode rejection and reset");
}
