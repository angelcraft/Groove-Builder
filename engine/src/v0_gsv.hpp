#pragma once
#include "v0_session.hpp"
#include <cstdio>
#include <cstring>
#include <cstdint>
namespace groove::v0::gsv {
constexpr unsigned Size=160,JournalSize=340;
struct Record {char id[97]{};uint32_t seq=0,plays=0,clears=0;uint8_t state=2;};
inline uint32_t get(const uint8_t* b){return uint32_t(b[0])|(uint32_t(b[1])<<8)|(uint32_t(b[2])<<16)|(uint32_t(b[3])<<24);}
inline void put(uint8_t* b,uint32_t n){for(unsigned i=0;i<4;++i)b[i]=uint8_t(n>>(8*i));}
inline uint32_t crc(const uint8_t* b,unsigned n){uint32_t c=~0u;for(unsigned i=0;i<n;++i){c^=b[i];for(unsigned k=0;k<8;++k)c=(c>>1)^(0xEDB88320u&uint32_t(-int(c&1)));}return ~c;}
inline bool safeId(const char* id){if(!validId(id))return false;char base[97];unsigned i=0;while(id[i]&&id[i]!='.'){base[i]=id[i];++i;}base[i]=0;return std::strcmp(base,"con")&&std::strcmp(base,"prn")&&std::strcmp(base,"aux")&&std::strcmp(base,"nul")&&!(i==4&&(!std::memcmp(base,"com",3)||!std::memcmp(base,"lpt",3))&&base[3]>='0'&&base[3]<='9');}
inline bool encode(const Record& r,uint8_t (&b)[Size]){
 if(!safeId(r.id)||r.clears>r.plays||r.state<2||r.state>3||((r.clears!=0)!=(r.state==3)))return false;
 std::memset(b,0,Size);std::memcpy(b,"GSV1",4);b[4]=1;b[6]=160;put(b+12,r.seq);std::memcpy(b+16,r.id,std::strlen(r.id));b[116]=r.state;put(b+120,r.plays);put(b+124,r.clears);put(b+8,crc(b+12,148));return true;
}
inline bool decode(const uint8_t* b,unsigned n,const char* id,Record& out){
 if(n!=Size||!safeId(id)||std::memcmp(b,"GSV1",4)||b[4]!=1||b[5]||b[6]!=160||b[7]||get(b+8)!=crc(b+12,148))return false;
 Record r;unsigned len=std::strlen(id);if(std::memcmp(b+16,id,len)||b[16+len])return false;
 for(unsigned i=16+len;i<116;++i)if(b[i])return false;
 for(unsigned i=117;i<120;++i)if(b[i])return false;
 for(unsigned i=128;i<160;++i)if(b[i])return false; // score/rank/perfect/reserved disabled
 std::strcpy(r.id,id);r.seq=get(b+12);r.state=b[116];r.plays=get(b+120);r.clears=get(b+124);
 uint8_t check[Size];if(!encode(r,check))return false;out=r;return true;
}
struct Intent {uint64_t token=0;uint8_t before[Size]{},after[Size]{};};
inline bool intent(const Record& old,uint64_t token,bool cleared,Intent& out){
 if(!token||old.seq==UINT32_MAX||old.plays==UINT32_MAX||(cleared&&old.clears==UINT32_MAX))return false;
 Intent t;t.token=token;if(!encode(old,t.before))return false;Record next=old;++next.seq;++next.plays;if(cleared)++next.clears;next.state=next.clears?3:2;
 if(!encode(next,t.after))return false;out=t;return true;
}
inline bool journal(const Intent& t,uint8_t (&b)[JournalSize]){
 Record a,c;char id[97]{};std::memcpy(id,t.before+16,96);
 if(!decode(t.before,Size,id,a)||!decode(t.after,Size,id,c)||!t.token||a.seq==UINT32_MAX||a.plays==UINT32_MAX||c.seq!=a.seq+1||c.plays!=a.plays+1||c.clears<a.clears||c.clears-a.clears>1)return false;
 std::memset(b,0,JournalSize);std::memcpy(b,"GJ01",4);put(b+4,1);put(b+8,uint32_t(t.token));put(b+12,uint32_t(t.token>>32));std::memcpy(b+16,t.before,Size);std::memcpy(b+176,t.after,Size);put(b+336,crc(b,336));return true;
}
inline bool unjournal(const uint8_t* b,unsigned n,const char* id,Intent& out){
 if(n!=JournalSize||std::memcmp(b,"GJ01",4)||get(b+4)!=1||get(b+336)!=crc(b,336))return false;
 Intent t;t.token=get(b+8)|(uint64_t(get(b+12))<<32);std::memcpy(t.before,b+16,Size);std::memcpy(t.after,b+176,Size);
 Record r;if(!decode(t.before,Size,id,r))return false;uint8_t expected[JournalSize];if(!journal(t,expected)||std::memcmp(b,expected,JournalSize))return false;out=t;return true;
}
enum class Read {Missing,Present,Error,Oversized};
enum class Status {Initial,Loaded,RecoveryAvailable,Blocked,Pending,Committed,Conflict};
// Injectable IO: all operations below occur under a per-ID exclusive lock.
// Reads bounded incl actual file length; writes create-new, renames never replace.
// flush(file) and sync(directory) have distinct fault points. No FAT durability claim.
struct IO {
 virtual ~IO()=default;
 virtual bool lock(const char*)=0;virtual void unlock()=0;
 virtual Read read(const char*,uint8_t*,unsigned,unsigned&)=0;
 virtual bool create(const char*,const uint8_t*,unsigned)=0;
 virtual bool flush(const char*)=0;virtual bool sync()=0;
 virtual bool rename(const char*,const char*)=0;virtual bool remove(const char*)=0;
};
struct Paths {char main[160],backup[164],pending[168],temp[168];
 explicit Paths(const char* id){std::snprintf(main,sizeof(main),"custom-saves/%s.gsv",id);std::snprintf(backup,sizeof(backup),"%s.bak",main);std::snprintf(pending,sizeof(pending),"%s.pending",main);std::snprintf(temp,sizeof(temp),"%s.new",main);}
};
struct Lock {IO& io;bool held;Lock(IO& f,const char* id):io(f),held(f.lock(id)){}~Lock(){if(held)io.unlock();}};
inline Status loadUnlocked(IO& io,const char* id,Record& out){
 if(!safeId(id))return Status::Blocked;Paths p(id);uint8_t b[JournalSize];unsigned n=0;
 auto pending=io.read(p.pending,b,sizeof(b),n);if(pending!=Read::Missing)return Status::Blocked;
 if(io.read(p.temp,b,Size,n)!=Read::Missing)return Status::Blocked; // orphan evidence, never reset silently
 auto main=io.read(p.main,b,Size,n);Record r;if(main==Read::Present&&decode(b,n,id,r)){out=r;return Status::Loaded;}
 if(main==Read::Error)return Status::Blocked;
 auto backup=io.read(p.backup,b,Size,n);if(backup==Read::Present&&decode(b,n,id,r)){out=r;return Status::RecoveryAvailable;}
 if(main!=Read::Missing||backup!=Read::Missing)return Status::Blocked;
 r={};std::strcpy(r.id,id);out=r;return Status::Initial;
}
inline Status load(IO& io,const char* id,Record& out){if(!safeId(id))return Status::Blocked;Lock l(io,id);return l.held?loadUnlocked(io,id,out):Status::Blocked;}
inline Status commit(IO& io,const char* id,const Intent& t){
 if(!safeId(id))return Status::Blocked;uint8_t j[JournalSize];Record before,after;
 if(!decode(t.before,Size,id,before)||!decode(t.after,Size,id,after)||!journal(t,j))return Status::Blocked;
 Lock l(io,id);if(!l.held)return Status::Pending;Paths p(id);uint8_t b[JournalSize];unsigned n=0;
 auto jr=io.read(p.pending,b,JournalSize,n);if(jr==Read::Error)return Status::Pending;if(jr==Read::Oversized)return Status::Conflict;
 if(jr==Read::Present&&(n!=JournalSize||std::memcmp(j,b,n)))return Status::Conflict;
 char receipt[208];std::snprintf(receipt,sizeof(receipt),"%s.done-%u-%llu",p.main,after.seq,(unsigned long long)t.token);
 auto rr=io.read(receipt,b,JournalSize,n);if(rr==Read::Error)return Status::Pending;if(rr==Read::Oversized)return Status::Conflict;
 if(rr==Read::Present&&(n!=JournalSize||std::memcmp(j,b,n)))return Status::Conflict;
 auto acknowledge=[&](bool hasPending){
  if(rr==Read::Missing){if(!hasPending)return Status::Conflict;if(!io.rename(p.pending,receipt))return Status::Pending;}
  else if(hasPending && !io.remove(p.pending))return Status::Pending;
  return io.flush(receipt)&&io.sync()?Status::Committed:Status::Pending;
 };
 auto current=io.read(p.main,b,Size,n);if(current==Read::Error)return Status::Pending;if(current==Read::Oversized)return Status::Conflict;
 if(current==Read::Present&&n==Size&&!std::memcmp(b,t.after,Size)){
  // Lost ack: repeat flush/sync before claiming committed, never count twice.
  if(!io.flush(p.main)||!io.sync())return Status::Pending;
  return acknowledge(jr==Read::Present);
 }
 if(rr==Read::Present)return Status::Conflict; // completed intent cannot replay over an older/different main
 if(current==Read::Present&&(n!=Size||std::memcmp(b,t.before,Size)))return Status::Conflict;
 if(jr==Read::Missing){
  if(current==Read::Missing){
   if(before.seq||before.plays||before.clears)return Status::Conflict;
   auto backup=io.read(p.backup,b,Size,n);if(backup!=Read::Missing)return backup==Read::Error?Status::Pending:Status::RecoveryAvailable;
  }
  if(!io.create(p.pending,j,JournalSize)||!io.flush(p.pending)||!io.sync())return Status::Pending;
 }else if(!io.flush(p.pending)||!io.sync())return Status::Pending;
 if(current==Read::Missing&&before.seq){
  auto backup=io.read(p.backup,b,Size,n);if(backup!=Read::Present||n!=Size||std::memcmp(b,t.before,Size))return Status::Conflict;
 }
 auto tmp=io.read(p.temp,b,Size,n);if(tmp==Read::Error)return Status::Pending;if(tmp==Read::Oversized)return Status::Conflict;
 if(tmp==Read::Present&&(n!=Size||std::memcmp(b,t.after,Size)))return Status::Conflict;
 if(tmp==Read::Missing&&!io.create(p.temp,t.after,Size))return Status::Pending;
 if(!io.flush(p.temp))return Status::Pending;
 if(current==Read::Present){
  auto backup=io.read(p.backup,b,Size,n);if(backup==Read::Error)return Status::Pending;if(backup==Read::Oversized)return Status::Conflict;
  if(backup==Read::Present){Record old;if(!decode(b,n,id,old))return Status::Conflict;char archive[192];std::snprintf(archive,sizeof(archive),"%s-%u",p.backup,old.seq);if(!io.rename(p.backup,archive))return Status::Pending;}
  if(!io.rename(p.main,p.backup)||!io.sync())return Status::Pending;
 }
 if(!io.rename(p.temp,p.main)||!io.sync()||!io.flush(p.main))return Status::Pending;
 return acknowledge(true);
}
// Explicit operator-approved recovery; never called automatically by load/arm.
// Preserve corrupt current under a fresh evidence name, and keep backup intact.
inline Status restoreBackup(IO& io,const char* id,uint64_t recoveryToken){
 if(!safeId(id)||!recoveryToken)return Status::Blocked;Lock l(io,id);if(!l.held)return Status::Pending;Paths p(id);
 uint8_t old[JournalSize],backup[Size];unsigned n=0,bn=0;Record record;
 if(io.read(p.pending,old,JournalSize,n)!=Read::Missing)return Status::Blocked;
 if(io.read(p.backup,backup,Size,bn)!=Read::Present||!decode(backup,bn,id,record))return Status::Blocked;
 auto main=io.read(p.main,old,Size,n);if(main==Read::Error)return Status::Pending;
 if(main==Read::Present){Record current;if(decode(old,n,id,current)){
   if(n==Size&&!std::memcmp(old,backup,Size))return io.flush(p.main)&&io.sync()?Status::Committed:Status::Pending;
   return Status::Conflict; // never downgrade a valid current record
 }}
 char evidence[208],temp[208];std::snprintf(evidence,sizeof(evidence),"%s.corrupt-%llu",p.main,(unsigned long long)recoveryToken);
 std::snprintf(temp,sizeof(temp),"%s.restore-%llu",p.main,(unsigned long long)recoveryToken);
 unsigned tn=0;auto tmp=io.read(temp,old,Size,tn);if(tmp==Read::Error)return Status::Pending;if(tmp==Read::Oversized)return Status::Conflict;
 if(tmp==Read::Present&&(tn!=Size||std::memcmp(old,backup,Size)))return Status::Conflict;
 if(tmp==Read::Missing&&!io.create(temp,backup,Size))return Status::Pending;
 if(!io.flush(temp)||!io.sync())return Status::Pending;
 if((main==Read::Present||main==Read::Oversized)&&(!io.rename(p.main,evidence)||!io.sync()))return Status::Pending;
 if(!io.rename(temp,p.main)||!io.flush(p.main)||!io.sync())return Status::Pending;return Status::Committed;
}
inline Status recover(IO& io,const char* id,Intent& recovered){
 if(!safeId(id))return Status::Blocked;uint8_t b[JournalSize];unsigned n=0;
 {Lock l(io,id);if(!l.held)return Status::Pending;Paths p(id);if(io.read(p.pending,b,JournalSize,n)!=Read::Present||!unjournal(b,n,id,recovered))return Status::Blocked;}
 // commit rechecks journal under a fresh exclusive lock; it never trusts the gap.
 return commit(io,id,recovered);
}
}
