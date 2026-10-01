#include "RifeExtensionArchive.h"
#include <QCryptographicHash>
#include <QDir>
#include <QDirIterator>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMap>
#include <QRegularExpression>
#include <QSaveFile>
#include <QSet>
#include <QStorageInfo>
#include <QVersionNumber>
#include <QtEndian>
#include <cmath>
#include <limits>
#include "miniz.h"

namespace rife {
namespace {
constexpr qint64 MaxInteger=9007199254740991LL;
constexpr qint64 MaxManifest=256*1024;
constexpr qint64 ReserveBytes=256*1024*1024;
constexpr int MaxFiles=4096;
const QString Abi=QStringLiteral("windows-nvidia-trt-r79-v1");
bool integer(const QJsonValue& value,qint64* out,qint64 minimum=0) {
    if(!value.isDouble())return false;
    const auto n=value.toDouble();
    if(!std::isfinite(n)||n<minimum||n>MaxInteger||std::floor(n)!=n)return false;
    *out=static_cast<qint64>(n);return true;
}
bool hashValid(const QJsonValue& value) {
    static const QRegularExpression pattern(QStringLiteral("^[0-9a-f]{64}$"));
    return value.isString()&&pattern.match(value.toString()).hasMatch();
}
bool version(const QString& value,QVersionNumber* number) {
    static const QRegularExpression pattern(QStringLiteral("^[0-9]+\\.[0-9]+\\.[0-9]+$"));
    if(!pattern.match(value).hasMatch())return false;
    qsizetype suffix=0;*number=QVersionNumber::fromString(value,&suffix);
    return suffix==value.size()&&number->segmentCount()==3;
}
bool safeName(const QString& name) {
    static const QRegularExpression reserved(QStringLiteral("^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(\\..*)?$"),QRegularExpression::CaseInsensitiveOption);
    if(name.isEmpty()||name.size()>240||name.contains('\\')||name.normalized(QString::NormalizationForm_C)!=name)return false;
    for(const auto& part:name.split('/')) {
        if(part.isEmpty()||part=="."||part==".."||part.endsWith(' ')||part.endsWith('.')||reserved.match(part).hasMatch())return false;
        for(const auto c:part)if(c.unicode()<32||QStringLiteral("<>:\"|?*").contains(c))return false;
    }
    return true;
}
bool cancelled(const RifeExtensionArchive::Options& options) {
    return options.cancelled&&options.cancelled->load(std::memory_order_relaxed);
}
QString digest(QFile& file,const RifeExtensionArchive::Options& options) {
    if(!file.seek(0))return {};
    QCryptographicHash hash(QCryptographicHash::Sha256);
    while(!file.atEnd()) {
        if(cancelled(options))return {};
        const auto block=file.read(1024*1024);
        if(block.isEmpty())return {};
        hash.addData(block);
    }
    return QString::fromLatin1(hash.result().toHex());
}
bool plainTree(const QString& absolute) {
    QString current=QDir::cleanPath(absolute);
    for(;;) {
        const QFileInfo info(current);
        if(info.isSymLink()||info.isJunction())return false;
        const auto parent=info.absolutePath();
        if(parent==current)break;
        current=parent;
    }
    return true;
}
struct Reader {
    QFile file;
    mz_zip_archive zip{};
    bool opened=false;
    explicit Reader(const QString& path):file(path) {}
    ~Reader(){if(opened)mz_zip_reader_end(&zip);}
    static size_t read(void* opaque,mz_uint64 offset,void* data,size_t count) {
        auto* self=static_cast<Reader*>(opaque);
        if(offset>static_cast<mz_uint64>(std::numeric_limits<qint64>::max())||count>static_cast<size_t>(std::numeric_limits<qint64>::max())||!self->file.seek(static_cast<qint64>(offset)))return 0;
        const auto n=self->file.read(static_cast<char*>(data),static_cast<qint64>(count));
        return n<0?0:static_cast<size_t>(n);
    }
    bool open(){zip.m_pRead=read;zip.m_pIO_opaque=this;opened=mz_zip_reader_init(&zip,static_cast<mz_uint64>(file.size()),MZ_ZIP_FLAG_DO_NOT_SORT_CENTRAL_DIRECTORY);return opened;}
};
struct Entry { mz_zip_archive_file_stat stat{}; QString name; };
struct Writer {
    QSaveFile* file=nullptr;
    QCryptographicHash hash{QCryptographicHash::Sha256};
    const RifeExtensionArchive::Options* options=nullptr;
    qint64 offset=0,limit=0,base=0,total=0;
    static size_t write(void* opaque,mz_uint64 offset,const void* data,size_t count) {
        auto* self=static_cast<Writer*>(opaque);
        if(cancelled(*self->options)||offset!=static_cast<mz_uint64>(self->offset)||count>static_cast<size_t>(self->limit-self->offset))return 0;
        const auto length=static_cast<qint64>(count);
        if(self->file->write(static_cast<const char*>(data),length)!=length)return 0;
        self->hash.addData(QByteArrayView(static_cast<const char*>(data),static_cast<qsizetype>(length)));
        self->offset+=length;
        if(self->options->progress)self->options->progress(self->base+self->offset,self->total);
        return count;
    }
};
}

QJsonObject RifeExtensionArchive::catalogPackage(const QJsonObject& catalog,const QString& id,
    const QString& appVersion,QString* error)
{
    auto fail=[&](const QString& text){if(error)*error=text;return QJsonObject{};};
    if(error)error->clear();
    if(catalog["schemaVersion"]!=1||!catalog["packages"].isArray())return fail("Unsupported trusted catalog");
    QJsonObject item;int matches=0;
    for(const auto& value:catalog["packages"].toArray())if(value.toObject()["id"].toString()==id){item=value.toObject();++matches;}
    if(matches!=1)return fail("Package is not uniquely listed in the trusted catalog");
    static const QRegularExpression idPattern(QStringLiteral("^[a-z0-9][a-z0-9-]{0,63}$"));
    static const QRegularExpression shaPattern(QStringLiteral("^[0-9a-f]{40}$"));
    if(!idPattern.match(id).hasMatch()||!shaPattern.match(item["sourceSha"].toString()).hasMatch()||item["runtimeId"].toString().isEmpty())return fail("Invalid catalog identity");
    if(item["platform"]!="windows"||item["architecture"]!="x64"||item["abi"]!=Abi)return fail("Unsupported extension architecture or ABI");
    QVersionNumber app,minimum,maximum,packageVersion;
    if(!version(appVersion,&app)||!version(item["minAppVersion"].toString(),&minimum)||!version(item["maxAppVersion"].toString(),&maximum)||!version(item["version"].toString(),&packageVersion)||!(minimum<maximum))return fail("Extension is incompatible with this application version");
    // A sealed archive retains its original version range and identity. The
    // embedded trusted catalog can approve specific subsequently tested apps
    // without changing that archive or weakening its hash/ABI checks.
    bool explicitlyCompatible=false;
    if(item.contains("compatibleAppVersions")) {
        if(!item["compatibleAppVersions"].isArray())return fail("Invalid catalog application compatibility");
        for(const auto& value:item["compatibleAppVersions"].toArray()) {
            QVersionNumber approved;
            if(!value.isString()||!version(value.toString(),&approved)||approved<minimum)return fail("Invalid catalog application compatibility");
            explicitlyCompatible|=approved==app;
        }
    }
    if(!(minimum<=app&&(app<maximum||explicitlyCompatible)))return fail("Extension is incompatible with this application version");
    if(!hashValid(item["sha256"])||!hashValid(item["manifestSha256"]))return fail("Invalid catalog hash");
    qint64 size=0,count=0;
    if(!integer(item["downloadSize"],&size,1)||!integer(item["unpackedSize"],&size,1)||!integer(item["fileCount"],&count,1)||count>MaxFiles)return fail("Invalid catalog sizes");
    return item;
}

RifeExtensionArchive::Result RifeExtensionArchive::extract(const QString& archive,const QJsonObject& item,
    const QString& staging,const Options& options)
{
    Result result;
    auto fail=[&](const QString& text){result.error=text;return result;};
    qint64 downloadSize=0,unpackedSize=0,fileCount=0;
    if(!integer(item["downloadSize"],&downloadSize,1)||!integer(item["unpackedSize"],&unpackedSize,1)||!integer(item["fileCount"],&fileCount,1)||fileCount>MaxFiles||!hashValid(item["sha256"])||!hashValid(item["manifestSha256"]))return fail("Invalid catalog sizes/hash");
    const QFileInfo stageInfo(staging);
    if(!stageInfo.isDir()||!plainTree(stageInfo.absoluteFilePath())||!QDir(staging).entryList(QDir::AllEntries|QDir::Hidden|QDir::System|QDir::NoDotAndDotDot).isEmpty())return fail("Installer requires an empty staging directory without links");
    if(options.progress)options.progress(0,unpackedSize);
    if(cancelled(options))return fail("Extension operation cancelled");
    const auto freeBytes=options.availableBytes?options.availableBytes(staging):QStorageInfo(staging).bytesAvailable();
    if(freeBytes<0||unpackedSize>MaxInteger-ReserveBytes||freeBytes<unpackedSize+ReserveBytes)return fail("Insufficient disk space for extension staging");
    Reader reader(archive);
    if(!reader.file.open(QIODevice::ReadOnly)||reader.file.size()!=downloadSize||digest(reader.file,options)!=item["sha256"].toString())return fail(cancelled(options)?"Extension operation cancelled":"Archive size/hash differs from trusted catalog");
    if(!reader.open())return fail("Invalid ZIP64 archive");
    if(reader.zip.m_total_files!=fileCount)return fail("Archive entry count differs from catalog");
    QMap<QString,Entry> entries;
    qint64 total=0;
    for(mz_uint i=0;i<reader.zip.m_total_files;++i) {
        Entry entry;
        if(!mz_zip_reader_file_stat(&reader.zip,i,&entry.stat))return fail("Invalid ZIP64 entry");
        const auto length=mz_zip_reader_get_filename(&reader.zip,i,nullptr,0);
        if(length<2||length>961)return fail("Invalid archive file path");
        QByteArray raw(static_cast<qsizetype>(length),'\0');
        if(mz_zip_reader_get_filename(&reader.zip,i,raw.data(),length)!=length)return fail("Invalid archive file path");
        raw.chop(1);
        entry.name=QString::fromUtf8(raw);
        if(entry.name.toUtf8()!=raw||!safeName(entry.name))return fail("Invalid archive file path");
        // miniz extracts by central index and skips the local filename. Compare
        // complete raw bytes ourselves, including zero-length payload entries.
        unsigned char local[30];
        if(Reader::read(&reader,entry.stat.m_local_header_ofs,local,sizeof(local))!=sizeof(local)
            ||qFromLittleEndian<quint32>(local)!=0x04034b50
            ||qFromLittleEndian<quint16>(local+6)!=entry.stat.m_bit_flag
            ||qFromLittleEndian<quint16>(local+8)!=entry.stat.m_method
            ||qFromLittleEndian<quint16>(local+26)!=raw.size())return fail("Local/central archive file path or header differs");
        QByteArray localName(raw.size(),'\0');
        if(downloadSize<static_cast<qint64>(sizeof(local))||entry.stat.m_local_header_ofs>static_cast<mz_uint64>(downloadSize-static_cast<qint64>(sizeof(local)))
            ||Reader::read(&reader,entry.stat.m_local_header_ofs+sizeof(local),localName.data(),static_cast<size_t>(localName.size()))!=static_cast<size_t>(localName.size())
            ||localName!=raw)return fail("Local/central archive file path differs");
        const auto key=entry.name.toCaseFolded();
        if(entries.contains(key))return fail("Duplicate Windows archive path");
        const auto mode=(entry.stat.m_external_attr>>16)&0170000;
        if(entry.stat.m_is_directory||(mode!=0&&mode!=0100000)||(entry.stat.m_external_attr&0x410))return fail("Archive link/non-file entry is forbidden");
        if(entry.stat.m_is_encrypted||!entry.stat.m_is_supported||(entry.stat.m_method!=0&&entry.stat.m_method!=8))return fail("Unsupported archive entry encoding");
        if(entry.stat.m_uncomp_size>static_cast<mz_uint64>(unpackedSize-total))return fail("Archive unpacked size exceeds catalog");
        total+=static_cast<qint64>(entry.stat.m_uncomp_size);entries.insert(key,entry);
    }
    if(total!=unpackedSize)return fail("Archive unpacked size differs from catalog");
    for(auto it=entries.cbegin();it!=entries.cend();++it) {
        auto path=it.key();
        while(path.contains('/')){path=path.left(path.lastIndexOf('/'));if(entries.contains(path))return fail("Archive file/directory path collision");}
    }
    const auto header=entries.constFind("extension.json");
    if(header==entries.cend()||header->name!="extension.json"||header->stat.m_uncomp_size>MaxManifest)return fail("Missing/oversized extension file manifest");
    QByteArray bytes(static_cast<qsizetype>(header->stat.m_uncomp_size),'\0');
    if(!mz_zip_reader_extract_to_mem(&reader.zip,header->stat.m_file_index,bytes.data(),static_cast<size_t>(bytes.size()),0))return fail("Corrupt extension manifest");
    if(QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex())!=item["manifestSha256"].toString())return fail("Extension manifest hash differs from catalog");
    QJsonParseError parseError;
    const auto document=QJsonDocument::fromJson(bytes,&parseError);
    if(parseError.error!=QJsonParseError::NoError||!document.isObject()||document.object()["schemaVersion"]!=1)return fail("Unsupported extension manifest");
    result.manifest=document.object();
    for(const auto& key:{"id","version","platform","architecture","abi","runtimeId","minAppVersion","maxAppVersion","sourceSha"})if(result.manifest[key]!=item[key])return fail(QStringLiteral("Extension identity differs from catalog: ")+key);
    const auto files=result.manifest["files"].toArray();
    if(!result.manifest["files"].isArray()||files.size()+1!=fileCount)return fail("Extension file list differs from archive entries");
    QMap<QString,QJsonObject> expected;
    for(const auto& value:files) {
        const auto file=value.toObject();const auto name=file["path"].toString();const auto key=name.toCaseFolded();
        if(!safeName(name))return fail("Invalid archive file path in manifest");
        if(expected.contains(key)||key=="extension.json")return fail("Duplicate extension file path");
        qint64 size=0;const auto found=entries.constFind(key);
        if(found==entries.cend()||found->name!=name||!integer(file["size"],&size)||static_cast<mz_uint64>(size)!=found->stat.m_uncomp_size)return fail("Missing/changed extension file entry");
        if(!hashValid(file["sha256"]))return fail("Invalid extension file hash");
        expected.insert(key,file);
    }
    if(expected.size()+1!=entries.size())return fail("Unlisted archive file entry");
    const auto root=stageInfo.canonicalFilePath();
    qint64 done=0;
    for(auto it=entries.cbegin();it!=entries.cend();++it) {
        if(cancelled(options))return fail("Extension operation cancelled");
        const auto target=root+"/"+it->name;
        const QFileInfo targetInfo(target);
        if(QFileInfo::exists(target)||!QDir().mkpath(targetInfo.absolutePath())||!plainTree(targetInfo.absolutePath()))return fail("Cannot create private staging file");
        QSaveFile output(target);output.setDirectWriteFallback(false);
        if(!output.open(QIODevice::WriteOnly))return fail("Cannot write private staging file");
        Writer writer;writer.file=&output;writer.options=&options;writer.limit=static_cast<qint64>(it->stat.m_uncomp_size);writer.base=done;writer.total=unpackedSize;
        if(!mz_zip_reader_extract_to_callback(&reader.zip,it->stat.m_file_index,Writer::write,&writer,0)||writer.offset!=writer.limit)return fail(cancelled(options)?"Extension operation cancelled":"ZIP64 extraction/CRC check failed");
        const auto wanted=it.key()=="extension.json"?item["manifestSha256"]:expected[it.key()]["sha256"];
        if(QString::fromLatin1(writer.hash.result().toHex())!=wanted.toString())return fail("Corrupt extension file hash: "+it->name);
        if(cancelled(options))return fail("Extension operation cancelled");
        if(!output.commit())return fail("Cannot commit private staging file");
        done+=writer.offset;
    }
    result.ok=true;return result;
}

RifeExtensionArchive::Result RifeExtensionArchive::verifyInstalled(const QString& directory,const QJsonObject& item,
    const Options& options)
{
    Result result;auto fail=[&](const QString& text){result.error=text;return result;};
    const QFileInfo info(directory);
    if(!info.isDir()||!plainTree(info.absoluteFilePath()))return fail("Invalid installed extension directory");
    const auto root=info.canonicalFilePath();
    QFile header(root+"/extension.json");
    if(!plainTree(header.fileName())||!header.open(QIODevice::ReadOnly)||header.size()>MaxManifest)return fail("Missing/oversized installed extension manifest");
    const auto bytes=header.readAll();
    if(!hashValid(item["manifestSha256"])||QString::fromLatin1(QCryptographicHash::hash(bytes,QCryptographicHash::Sha256).toHex())!=item["manifestSha256"].toString())return fail("Installed manifest hash differs from trusted catalog");
    QJsonParseError error;const auto doc=QJsonDocument::fromJson(bytes,&error);
    if(error.error!=QJsonParseError::NoError||!doc.isObject()||doc.object()["schemaVersion"]!=1)return fail("Unsupported installed manifest");
    result.manifest=doc.object();
    for(const auto& key:{"id","version","platform","architecture","abi","runtimeId","minAppVersion","maxAppVersion","sourceSha"})if(result.manifest[key]!=item[key])return fail("Installed extension identity differs from catalog");
    qint64 fileCount=0,unpackedSize=0;
    const auto files=result.manifest["files"].toArray();
    if(!integer(item["fileCount"],&fileCount,1)||fileCount>MaxFiles||!integer(item["unpackedSize"],&unpackedSize,1)||!result.manifest["files"].isArray()||files.size()+1!=fileCount)return fail("Installed file count differs from catalog");
    QSet<QString> expected{"extension.json"};qint64 done=bytes.size();
    for(const auto& value:files) {
        if(cancelled(options))return fail("Extension operation cancelled");
        const auto entry=value.toObject();const auto name=entry["path"].toString();const auto key=name.toCaseFolded();qint64 size=0;
        if(!safeName(name)||expected.contains(key))return fail("Invalid installed extension file path");
        expected.insert(key);
        if(!integer(entry["size"],&size)||size>unpackedSize-done||!hashValid(entry["sha256"]))return fail("Invalid installed file size/hash");
        QFile file(root+"/"+name);
        if(!plainTree(file.fileName())||!QFileInfo(file).isFile()||!file.open(QIODevice::ReadOnly)||file.size()!=size)return fail("Missing/changed installed file: "+name);
        if(digest(file,options)!=entry["sha256"].toString())return fail(cancelled(options)?"Extension operation cancelled":"Corrupt installed file hash: "+name);
        done+=size;if(options.progress)options.progress(done,unpackedSize);
    }
    if(done!=unpackedSize)return fail("Installed unpacked size differs from catalog");
    QDirIterator iterator(root,QDir::AllEntries|QDir::Hidden|QDir::System|QDir::NoDotAndDotDot,QDirIterator::Subdirectories);
    QSet<QString> found;
    while(iterator.hasNext()) {
        iterator.next();const auto file=iterator.fileInfo();
        if(file.isSymLink()||file.isJunction())return fail("Installed extension link is forbidden");
        if(file.isDir())continue;
        const auto name=QDir(root).relativeFilePath(file.absoluteFilePath());
        if(!file.isFile()||!safeName(name)||!expected.contains(name.toCaseFolded())||found.contains(name.toCaseFolded()))return fail("Unlisted installed extension file");
        found.insert(name.toCaseFolded());
    }
    if(found!=expected)return fail("Missing installed extension file");
    result.ok=true;return result;
}
}
