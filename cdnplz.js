module.exports = cdnplz;

const glob = require('glob');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');

// 标签与属性的对应关系
const typeMap = {
    'img': 'src',
    'script': 'src',
    'embed': 'src',
    'link': 'href',
    'object': 'data'
}

function cdnplz(options){

    const cdnProvider = require(options.cdn_provider);

    // 需要处理的模版文件正则
    const pattern = `${options.tpl_path}/**/*.${options.tpl_suffix}`;

    // 命中的模板文件
    const tpls = glob.sync(pattern, {mark: true});

    // 缓存 CDN 文件上传，避免重复上传
    var cdnUrlMap = {};

    // 遍历模板文件内容，处理其中需要上传CDN的文件
    tpls.forEach( tpl => {
        //读取文件内容
        var fileContent = fs.readFileSync(tpl, 'utf8');
        //获取文件夹中需要上传 CDN 的文件名
        var fileNames = _getFileNameString(fileContent, options);

        fileNames.map(fileName => {
            fileName =  _getFileName(fileName); //处理字符串，只保留真正的文件名
            var fileNameWithPath = `${options.static_path}${fileName}`;
            cdnUrlMap[fileNameWithPath]
            ? cdnUrlMap[fileNameWithPath].push(tpl)
            : [tpl];
        });
    });

    for(var fileNameWithPath in cdnUrlMap){
        //上传CDN
        _uploadFile(cdnProvider, fileNameWithPath, options).then(data => {
            try{
                if(data){
                    //将地址缓存
                    cdnUrlMap[fileNameWithPath].forEach(file => {
                        var fileContent = fs.readFileSync(file, 'utf8');
                        //替换文件地址
                        fileContent = _replace(fileContent, new RegExp(fileName,'g'), data[fileNameWithPath]);
                        _saveFile(options, tpl, fileContent);
                    });
                }
            }catch(e){
                console.log(e);
            }
        });
    }
}

//写入指定 output 文件
function _saveFile(options, tpl, fileContent) {
    // 写入指定 output 文件
    console.log(outputFile);
    var outputFile = options.output_path + path.basename(tpl);
    console.log(outputFile);
    fs.stat(options.output_path,function(err, states){
        if(err || !states.isDirectory()){
            mkdirp.sync(options.output_path);
        }
        fs.writeFileSync(outputFile, fileContent ,options.file_encoding || 'utf8');
    })
}

//将相对地址替换成 CDN 地址
function _replace(fileContent, regex, url) {
    return fileContent.replace(regex, url);
}

// 获取该文件中所有需要替换的文件名
function _getFileNameString(fileContent, options) {
    var tempFiles = [],
        regex = '';
    for(var type in typeMap) {
        //jade模版
        if(options.tpl_suffix == 'jade') {
            regex = new RegExp(`(${type})(\s)*\((\s)*.*(${typeMap[type]}).*\)`,'ig')
        }
        var files = fileContent.match(regex);
        tempFiles = files ? tempFiles.concat(files) : tempFiles;
    }
    return tempFiles;
}

// 处理文件名
function _getFileName(fileName) {
    fileName = fileName.replace(/\'/g,'"');
    var type = fileName.substring(0,fileName.indexOf('('));
    var typeSrc = typeMap[type]+'="';
    var start = fileName.indexOf(typeSrc);
    var end = fileName.indexOf('"', start + typeSrc.length);
    return fileName.substring(start + typeSrc.length, end);
}

// 上传文件
function _uploadFile(cdnProvider, filePath, options) {
    try{
        if(options.cdn_provider == '@q/qcdn') {
            return cdnProvider.upload(filePath, options.plugins[options.cdn_provider]);
        }
    }catch(e){
        console.log(e.ERROR);
    }
    return Promise.resolve('');
}
