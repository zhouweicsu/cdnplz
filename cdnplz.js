'use strict'

const glob = require('glob');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const defaultOptions = {
    tpl_suffix: 'html,jade,ejs',   //模板文件后缀名
    tpl_path: '', //模板根目录
    static_path: '.',  //静态资源的目录
    output_path: '', //输出目录
    file_encoding: 'utf8', //文件编码
    cdn_provider: '',
    cdn_options: {}
};
const tplTypes = { // 标签与属性的对应关系
    'img': 'src',
    'script': 'src',
    'embed': 'src',
    'link': 'href',
    'object': 'data'
};

class cdnplz {

    constructor(options){
        this.startTime = new Date().getTime();//记录总用时的start
        this.options = Object.assign(defaultOptions, options); // 用户配置覆盖默认配置
        if(!this.checkOption('tpl_path') || !this.checkOption('static_path') || !this.checkOption('cdn_provider')){
            process.exit(1);
        }
        this.uploadingPromises = {};// 缓存文件上传的 Promise
        this.uploadedFiles = {};// 本地的CDN地址缓存文件
        this.cacheFile = './cdn.cache';// 本地的CDN地址缓存文件路径+名称
        this.resourceTree = []; // 静态资源树
        this.tplSuffixs = this.options.tpl_suffix.split(',');//本次上传需要分析的模板文件类型
        this.tempPath = require("os").tmpdir(); //获取存放临时文件的文件夹路径
        try { //获取用户自定义的 CDNProvider
            var cdnProviderName = 'cdnplz-'+this.options.cdn_provider;
            if(this.options.cdn_provider.indexOf('@')==0){
                cdnProviderName = this.options.cdn_provider;
            }
            this.cdnProvider = require(cdnProviderName);
        }catch(e){
            console.error(`ERROR：错误的 cdnProvider，${cdnProviderName} 不存在。`);
            process.exit(1);
        }
        try { //读取cdn.cache文件，返回一个json格式文件，key: md5, value: cdn 地址
            this.uploadedFiles = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        }catch(e){} //console.log(e); 若没有缓存文件，不报错
    }

    checkOption(opt) {
        if(!this.options[opt]){
            console.error(`ERROR: ${opt} 未配置。`);
            return false;
        }
        return true;
    }

    start() {
        const tpls = this.getTplFileNames();// 命中的模板文件名
        // 遍历模板文件内容，处理其中需要上传CDN的文件
        tpls.forEach( tpl => {
            this.resourceTree.push({//获取模板文件中需要上传 CDN 的资源文件名
                fileName: tpl,
                subResource: this.getSubResource(tpl)
            });
        });
        // 遍历资源树，处理其中的子资源
        var promises = this.resourceTree.map(res =>
            this.dealSubResource(res).then(data =>{
                var fileContent = fs.readFileSync(res.fileName, 'utf8');
                this.saveFile(res.fileName, this.replace(fileContent, data));
            }).catch(e => {
                console.log(e);
                process.exit(1);
            })
        );
        // cdn 上传结束
        Promise.all(promises).then(response => {
            fs.writeFileSync(this.cacheFile, JSON.stringify(this.uploadedFiles));
            const time = (new Date().getTime() - this.startTime)/1000;
            console.log(`-----${time}s-----\nDone!`);
        });
    }

    getSubResource(fileName) {// 获取 fileName 文件中所有需要上传的资源名称
        var suffix = this.getFileSuffix(fileName);
        if(!this.isCSSFile(fileName) && !this.isTplFile(fileName)) return null;
        const regexObj = this.getRegexes(suffix);
        const fileContent = fs.readFileSync(this.getFullPath(fileName), 'utf8');
        var subResource = [],
            resource;
        regexObj.regexes.forEach(regex => {
            while((resource = regex.exec(fileContent))) {
                if(!this.isUrl(resource[regexObj.group])){ //若是url，则不处理
                    subResource.push({
                        fileName: url.parse(resource[regexObj.group]).pathname,
                        subResource: this.getSubResource(resource[regexObj.group])
                    });
                }
            }
        });
        return subResource;
    }

    dealSubResource(res) {//递归处理子资源文件
        var promises = res.subResource.map(subres =>
            subres.subResource ? this.dealSubResource(subres) : this.uploadFile(subres.fileName)
        );

        return Promise.all(promises).then(response => {
            response.forEach(r => {// 处理response，将文件缓存
                for( var fileName in r ){
                    this.uploadedFiles[this.md5FileSync(fileName)] = r[fileName];
                }
            });
            if(this.isCSSFile(res.fileName)){// 替换CSS文件中的资源地址
                var cssContent = fs.readFileSync(this.getFullPath(res.fileName), 'utf8');
                this.saveFile(res.fileName, this.replace(cssContent, response));
                return this.uploadFile(res.fileName);
            } else {
                return Promise.resolve(response);
            }
        });
    }

    // 计算文件内容 md5 值
    md5FileSync (fileName) {
        var hash = crypto.createHash('md5');
        try {
            hash.update(fs.readFileSync(fileName, this.options.file_encoding));
        }catch(e){
            console.log(e);
            process.exit(1);
        }
        return hash.digest('hex');
    }

    //写入指定 output 文件
    saveFile(fileName, fileContent)  {
        var outputFile = (this.isCSSFile(fileName))
                         ? (this.tempPath + fileName)
                         : (fileName.replace(this.options.tpl_path, this.options.output_path));
        try{
            if(!fs.statSync(path.dirname(outputFile)).isdirectory()){
                mkdirp.sync(path.dirname(outputFile));
            }
        }catch(e){
            mkdirp.sync(path.dirname(outputFile));
        }
        fs.writeFileSync(outputFile, fileContent ,this.options.file_encoding || 'utf8');
    }

    //将相对地址替换成 CDN 地址
    replace(fileContent, subResCdnUrl) {
        if(!subResCdnUrl || !subResCdnUrl.length) return fileContent;
        subResCdnUrl.forEach(subRes => {
            for(var subResFileName in subRes) {
                var subStart = this.options.static_path.length;
                if(this.isCSSFile(subResFileName)) {
                    subStart = this.tempPath.length;
                }
                var replaceFileName = subResFileName.substring(subStart, subResFileName.length);
                fileContent = fileContent.replace(new RegExp(replaceFileName, 'ig'), subRes[subResFileName]);
            }
        });
        return fileContent;
    }

    // 上传文件
    uploadFile(fileName) {
        fileName = this.isCSSFile(fileName)
                   ? (this.tempPath+fileName)
                   : this.getFullPath(fileName);
        if(!fs.statSync(fileName).isFile()){
            console.error(`ERROR：文件 ${fileName} 不存在！`);
            return Promise.resolve(null);
        }
        if(this.uploadingPromises[fileName]) {  //判断本次是否已经上传过
            return this.uploadingPromises[fileName];
        }
        var uploadPromise;
        var md5 = this.md5FileSync(fileName); // 判断上一次执行cdnplz是否上传过该文件
        if(this.uploadedFiles[md5]){
            var cache = {};
            cache[fileName] = this.uploadedFiles[md5];
            uploadPromise = Promise.resolve(cache);
            this.uploadingPromises[fileName] = uploadPromise;
            return uploadPromise;
        }
        try{  // 上传
            console.log('上传文件'+fileName);
            uploadPromise = this.cdnProvider.upload(fileName, this.options.cdn_options);
            this.uploadingPromises[fileName] = uploadPromise;
            return uploadPromise;
        }catch(e){
            console.dir(e);
            process.exit(1);
        }
        return Promise.resolve(null);
    }

    getRegexes(type) {// 根据文件类型获取正则数组
        var types = Object.keys(tplTypes);
        var jadeRegs = types.map(type => new RegExp(`${type}(\\s|\\()*(.*?)${tplTypes[type]}(\\s|'|"|\\=)*(.*?)('|").*\\)`,'ig'));
        var htmlRegs = types.map(type => new RegExp(`<${type}(\\s)+(.*?)${tplTypes[type]}(\\s|'|"|\\=)*(.*?)('|").*?`,'ig'));
        if (type === 'jade')
            return {
                regexes: jadeRegs.concat(htmlRegs),
                group: 4
            }
        if (type === 'html' || type === 'ejs')
            return {
                regexes: htmlRegs,
                group: 4
            }
        if (type === 'css')
            return {
                regexes: [/url\(['"]?(.*?)['"]?\)/g],
                group: 1
            };
        return {};
    }

    getFullPath(fileName) {// 根据文件类型获取带路径文件全名
        const filePath = this.isTplFile(fileName) ? '' : this.options.static_path;
        return `${filePath}${fileName}`;
    }

    getFileSuffix(fileName) {// 获取文件类型 后缀名
        const extname = path.extname(fileName);
        return extname.substring(1, extname.length);
    }

    isCSSFile(fileName) {
        return this.getFileSuffix(fileName) === 'css';
    }

    isTplFile(fileName) {
        const suffix = this.getFileSuffix(fileName);
        return !this.tplSuffixs.every(ts => suffix != ts);
    }

    isUrl(str) { //判断字符串是否是url
        return /^((https?\:)?\/\/|(data\:))/i.test(str);
    }

    getTplFileNames() {
        if(this.tplSuffixs.length == 1 ){
            return glob.sync(`${this.options.tpl_path}/**/*.${this.tplSuffixs[0]}`, {mark: true});// 命中的模板文件
        }
        const tplGlob = this.tplSuffixs.map(suffix => {
             return `${this.options.tpl_path}/**/*.${suffix}`;
        });
        return glob.sync(`{${tplGlob.join(',')}}`, {mark: true});// 命中的模板文件
    }
};

module.exports = cdnplz;
