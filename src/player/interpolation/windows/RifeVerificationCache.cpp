#include "RifeVerificationCache.h"
#include <QFile>
#include <QFileInfo>
#include <QJsonDocument>
#include <QSaveFile>
#include <windows.h>
#include <wincrypt.h>
#include <winioctl.h>
#include <io.h>
#include <fcntl.h>
#include <array>
#include <algorithm>
#include <cstring>

namespace rife {
namespace {
bool plain(QString path) {
    for (;;) {
        const QFileInfo info(path);
        if (info.isSymLink() || info.isJunction()) return false;
        if (info.absolutePath() == path) return true;
        path = info.absolutePath();
    }
}
QByteArray protect(const QByteArray& bytes, bool encrypt) {
    DATA_BLOB input{DWORD(bytes.size()), reinterpret_cast<BYTE*>(const_cast<char*>(bytes.constData()))}, output{};
    const bool ok = encrypt
        ? CryptProtectData(&input, L"Tigerest RIFE verified files", nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)
        : CryptUnprotectData(&input, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output);
    if (!ok) return {};
    const QByteArray result(reinterpret_cast<const char*>(output.pbData), qsizetype(output.cbData));
    LocalFree(output.pbData);
    return result;
}
}
RifeVerificationCache::RifeVerificationCache(QString receipt, const QString& root, const QString& manifestHash)
    : path(std::move(receipt)), binding{{"schemaVersion", 2}, {"root", root.toCaseFolded()}, {"manifestSha256", manifestHash}} {
    if (path.isEmpty() || !plain(QFileInfo(path).absoluteFilePath())) return;
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > 1024 * 1024) return;
    const auto record = QJsonDocument::fromJson(protect(file.readAll(), false)).object();
    if (record["binding"].toObject() == binding) previous = record["files"].toObject();
}
bool RifeVerificationCache::openForVerification(QFile& file) {
    // Journal updates can be coalesced until a writable mapping closes. Deny
    // existing and new writers/deleters while inspecting or creating a receipt.
    const HANDLE handle=CreateFileW(file.fileName().toStdWString().c_str(),GENERIC_READ,
        FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
    if(handle==INVALID_HANDLE_VALUE)return false;
    const int descriptor=_open_osfhandle(reinterpret_cast<intptr_t>(handle),_O_RDONLY|_O_BINARY);
    if(descriptor<0){CloseHandle(handle);return false;}
    if(file.open(descriptor,QIODevice::ReadOnly,QFileDevice::AutoCloseHandle))return true;
    _close(descriptor);return false;
}
QJsonObject RifeVerificationCache::fingerprint(QFile& opened) {
    // Use the very handle being hashed, rather than reopening its pathname.
    const int descriptor=opened.handle();
    if(descriptor<0)return {};
    const HANDLE file=reinterpret_cast<HANDLE>(_get_osfhandle(descriptor));
    if (file == INVALID_HANDLE_VALUE) return {};
    FILE_BASIC_INFO basic{};
    FILE_STANDARD_INFO size{};
    FILE_ID_INFO identity{};
    USN_JOURNAL_DATA_V0 journal{};
    std::array<char,4096> record{};
    READ_FILE_USN_DATA request{2,2};
    DWORD journalBytes=0,recordBytes=0;
    wchar_t filesystem[32]{};
    const bool ok = GetFileInformationByHandleEx(file, FileBasicInfo, &basic, sizeof(basic)) &&
                    GetFileInformationByHandleEx(file, FileStandardInfo, &size, sizeof(size)) &&
                    GetFileInformationByHandleEx(file, FileIdInfo, &identity, sizeof(identity)) &&
                    GetVolumeInformationByHandleW(file, nullptr, 0, nullptr, nullptr, nullptr, filesystem, DWORD(std::size(filesystem))) &&
                    QString::fromWCharArray(filesystem)=="NTFS" &&
                    DeviceIoControl(file,FSCTL_QUERY_USN_JOURNAL,nullptr,0,&journal,sizeof(journal),&journalBytes,nullptr) &&
                    DeviceIoControl(file,FSCTL_READ_FILE_USN_DATA,&request,sizeof(request),record.data(),DWORD(record.size()),&recordBytes,nullptr);
    if (!ok || journalBytes<sizeof(journal) || !journal.UsnJournalID || basic.ChangeTime.QuadPart<=0 ||
        recordBytes<offsetof(USN_RECORD_V2,FileName) ||
        (basic.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY))) return {};
    USN_RECORD_V2 usn{};
    std::memcpy(&usn,record.data(),(std::min)(size_t(recordBytes),sizeof(usn)));
    if(usn.MajorVersion!=2 || usn.RecordLength>recordBytes || usn.Usn<=0 || usn.Usn>=journal.NextUsn)return {};
    // Mapped writes can leave all timestamps unchanged. USN covers them; its
    // journal generation prevents reuse after a journal reset. If any of this
    // information is unavailable, the caller hashes the complete file instead.
    const auto fileId=QByteArray(reinterpret_cast<const char*>(identity.FileId.Identifier),sizeof(identity.FileId.Identifier)).toHex();
    if(fileId==QByteArray(32,'0') || fileId==QByteArray(32,'f'))return {};
    // Store 64-bit values as strings to avoid JSON floating-point rounding.
    return {{"volume", QString::number(identity.VolumeSerialNumber)},
        {"fileId", QString::fromLatin1(fileId)},
        {"journal", QString::number(journal.UsnJournalID)},
        {"usn", QString::number(usn.Usn)},
        {"size", QString::number(size.EndOfFile.QuadPart)},
        {"created", QString::number(basic.CreationTime.QuadPart)},
        {"written", QString::number(basic.LastWriteTime.QuadPart)},
        {"changed", QString::number(basic.ChangeTime.QuadPart)}};
}
bool RifeVerificationCache::contains(const QString& name, const QString& hash, const QJsonObject& stamp) const {
    const auto entry = previous[name].toObject();
    return !path.isEmpty() && !stamp.isEmpty() && entry["sha256"] == hash && entry["fingerprint"].toObject() == stamp;
}
void RifeVerificationCache::remember(const QString& name, const QString& hash, const QJsonObject& stamp) {
    if (!stamp.isEmpty()) current.insert(name, QJsonObject{{"sha256", hash}, {"fingerprint", stamp}});
}
void RifeVerificationCache::save() const {
    if (path.isEmpty() || !plain(QFileInfo(path).absoluteFilePath())) return;
    const auto bytes = protect(QJsonDocument(QJsonObject{{"binding", binding}, {"files", current}}).toJson(QJsonDocument::Compact), true);
    if (bytes.isEmpty()) return;
    QSaveFile file(path);
    file.setDirectWriteFallback(false);
    if (file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size()) file.commit();
}
}
