module.exports = cdnplz1;

const glob = require('glob');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
const crypto = require('crypto');

const BUFFER_SIZE = 8192;

// 标签与属性的对应关系
const jadeTypeMap = {
    'img': 'src',
    'script': 'src',
    'embed': 'src',
    'link': 'href',
    'object': 'data'
}

// 用户配置
var _options = null;
// 缓存文件上传 Promise 缓存
var cdnCache = {};
var cdnCacheFromFile = {};
const cdnCacheFileName = './cdn.cache';

function cdnplz1(options){
    const start = new Date();
    _options = options;

    const cdnProvider = require(_options.cdn_provider);

    // 需要处理的模版文件正则
    const pattern = `${_options.tpl_path}/**/*.${_options.tpl_suffix}`;

    // 命中的模板文件
    const tpls = glob.sync(pattern, {mark: true});

    cdnCacheFromFile = _dealCacheFile(cdnCacheFileName);


    // 缓存 CDN 文件上传，避免重复上传
    var resourceTree = [];

    // 遍历模板文件内容，处理其中需要上传CDN的文件
    tpls.forEach( tpl => {
        //获取模板文件中需要上传 CDN 的资源文件名
        var resFileNames = {
            fileName: tpl,
            subResource: _getResource(tpl)
        };
        resourceTree.push(resFileNames);
    });

    var promises = [];
    resourceTree.forEach(res => {
        var p = _dealSubResource(res, cdnProvider).then(data => {
            var tplContent = fs.readFileSync(_getWholePathFile(res.fileName), 'utf8');
            tplContent = _replace(tplContent, data);
            _saveFile(res.fileName, tplContent);
        }).catch(e => {
            console.log(e);
        });
        promises.push(p);
    });
    // cdn 上传结束
    Promise.all(promises).then(response => {
        fs.writeFileSync(cdnCacheFileName, JSON.stringify(cdnCacheFromFile));
        const time = (new Date().getTime() - start.getTime())/1000;
        console.log(`-----${time}s-----\nDone!`);
    });
}

//处理上传之后的文件
function _dealSubResource(resourceTree, cdnProvider) {
    var promises = [];
    var suffix = _getFileSuffix(resourceTree.fileName);
    resourceTree.subResource.forEach(res => {
        if(res.subResource) {
            promises.push(_dealSubResource(res,  cdnProvider));
        }else {
            promises.push(_uploadFile(cdnProvider, res.fileName));
        }
    });

    return Promise.all(promises).then(response => {
        console.dir(response);
        // 处理response，将文件缓存
        response.forEach(r => {
            for( var fileName in r ){
                cdnCacheFromFile[_md5FileSync(fileName)] = r[fileName];
            }
        });
        console.dir(cdnCacheFromFile);
        // response 是上传完文件的所有子资源地址数组
        if(suffix == 'css'){
            // 替换文件中的资源地址
            var cssContent = fs.readFileSync(_getWholePathFile(resourceTree.fileName), 'utf8');
            cssContent = _replace(cssContent, response);
            _saveFile(resourceTree.fileName, cssContent);
            return _uploadFile(cdnProvider, resourceTree.fileName);
        }else {
            return Promise.resolve(response);
        }
    });
}
function _dealCacheFile(cdnCacheFileName) {
    try {
        return JSON.parse(fs.readFileSync(cdnCacheFileName, 'utf8'));
    }catch(e){
        console.log(e);
        return {};
    }
}

// 将文件内容 md5
function _md5FileSync (filename) {
  var fd = fs.openSync(filename, 'r');
  var hash = crypto.createHash('md5');
  var buffer = new Buffer(BUFFER_SIZE);

  try {
    var bytesRead;

    do {
      bytesRead = fs.readSync(fd, buffer, 0, BUFFER_SIZE);
      hash.update(buffer.slice(0, bytesRead));
    } while (bytesRead === BUFFER_SIZE)
  } finally {
    fs.closeSync(fd);
  }

  return hash.digest('hex');
}

//写入指定 output 文件
function _saveFile(file, fileContent)  {
    // 写入指定 output 文件
    var suffix = _getFileSuffix(file);
    var outputFile;
    if(suffix == 'css') {
        outputFile = _options.static_path + file;
    }else {
        outputFile = _options.output_path + path.basename(file);
    }
    console.log('\n---------------outputFile--------');
    console.log(outputFile);
    var stats;
    try{
        stats = fs.statSync(_options.output_path);
        if(!stats || !stats.isdirectory()){
            mkdirp.sync(_options.output_path);
            fs.writeFileSync(outputFile, fileContent ,_options.file_encoding || 'utf8');
        }
    }catch(e){
        mkdirp.sync(_options.output_path);
        fs.writeFileSync(outputFile, fileContent ,_options.file_encoding || 'utf8');
    }
}

//将相对地址替换成 CDN 地址
function _replace(fileContent, subResCdnUrl) {
    if( subResCdnUrl ){
        subResCdnUrl.forEach(subRes => {
            for(var subResFileName in subRes) {
                var replaceFileName = subResFileName.substring(_options.static_path.length, subResFileName.length);
                fileContent = fileContent.replace(new RegExp(replaceFileName, 'ig'), subRes[subResFileName]);
            }
        });
    }
    return fileContent;
}

// 上传文件
function _uploadFile(cdnProvider, fileName) {
    fileName = _getWholePathFile(fileName);
    if(cdnCache[fileName]) {
        return cdnCache[fileName];
    }
    var md5 = _md5FileSync(fileName);
    if(cdnCacheFromFile[md5]){
        var promise = Promise.resolve(cdnCacheFromFile[md5]);
        cdnCache[fileName] = uploadPromise;
        return uploadPromise;
    }
    try{
        if(_options.cdn_provider == '@q/qcdn') {
            console.log('上传文件'+fileName);
            var uploadPromise = cdnProvider.upload(fileName, _options.plugins[_options.cdn_provider]);
            cdnCache[fileName] = uploadPromise;
            return uploadPromise;
        }
    }catch(e){
        console.dir(e);
    }
    return Promise.resolve(null);
}


// 获取 fileName 文件中所有需要上传的资源名称
function _getResource(fileName) {
    const suffix = _getFileSuffix(fileName);
    if(suffix != 'css' && suffix != _options.tpl_suffix) return null;
    const regexObj = _getRegexes(suffix);
    const fileContent = fs.readFileSync(_getWholePathFile(fileName), 'utf8');
    var subResource = [],
        resource;
    regexObj.regexes.forEach(regex => {
        while((resource = regex.exec(fileContent))) {
            var match = resource[regexObj.index];
            if(!_getRegexes('url').test(match)){ //若不是一个url，则 push
                subResource.push({
                    fileName: resource[regexObj.index],
                    subResource: _getResource(resource[regexObj.index])
                });
            }
        }
    });
    return subResource;
}

// 根据文件类型获取带路径文件全名
function _getWholePathFile(fileName) {
    const suffix = _getFileSuffix(fileName);
    const filePath = (suffix == _options.tpl_suffix) ? '' : _options.static_path;
    return `${filePath}${fileName}`;
}

// 获取文件类型 后缀名
function _getFileSuffix(fileName) {
    const extname = path.extname(fileName);
    return extname.substring(1,extname.length);
}

// 根据文件类型获取正则数组
function _getRegexes(type) {
    switch(type) {
        case 'jade':
            var regexes = [];
            for(var type in jadeTypeMap) {
                regexes.push(new RegExp(`${type}(\\s|\\()*(.*?)${jadeTypeMap[type]}(\\s|\\'|\\"|\\=)*(.*?)(\\'|\\").*\\)`,'ig'));
            }
            return {
                regexes: regexes,
                index: 4
            };
        case 'css':
            return {
                regexes: [/url\((.*?)\)/g],
                index: 1
            };
        case 'url': return /^(https?\:\/\/)?([a-z\d\-]+\.)+[a-z]{2,6}[\/\?\#]?([\/\?\#][\w|\:|\/|\.|\-|\#|\!|\~|\%|\&|\+|\=|\?|\$]+)?$/i;
        default:
            return {};
    }
}

