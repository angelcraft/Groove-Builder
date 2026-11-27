#pragma once
namespace groove {
enum class SaveReplace { Committed, Unchanged, Restored, RecoveryRequired };
// tmp is complete and flushed. backup MUST be a fresh, unused path.
// Never delete a previous save. A committed replacement retains its backup.
// A power loss between renames leaves old data in backup (not full crash atomicity).
template<class Fs> SaveReplace replaceCustomSave(Fs& fs,const char* path,const char* tmp,const char* backup) {
    if (!fs.exists(tmp) || fs.exists(backup)) return SaveReplace::Unchanged;
    bool hadOld=fs.exists(path);
    if (hadOld && !fs.rename(path,backup)) return SaveReplace::Unchanged;
    if (fs.rename(tmp,path)) return SaveReplace::Committed;
    if (!hadOld) return SaveReplace::Unchanged;
    return fs.rename(backup,path) ? SaveReplace::Restored : SaveReplace::RecoveryRequired;
}
}
