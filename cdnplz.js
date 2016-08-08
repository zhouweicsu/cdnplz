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
// 缓存文件上传 Promise 缓存
var cdnCache = {};
// 本地的CDN地址缓存文件
var cdnCacheFromFile = {};
const cdnCacheFileName = './cdn.cache';

var cdnplz = {
    options: {
        tpl_suffix: 'html',   //模板文件后缀名
        tpl_path: 'app/view', //模板根目录
        static_path: '.',  //静态资源的目录
        output_path: 'output/view/', //输出目录
        file_encoding: 'utf8', //文件编码
        cdn_provider: '',
        plugins: {
            qiniu: {
                https: true
            }
        }
    },
    init(options) {
        const start = new Date();
        this.options = Object.assign(this.options, options);
        console.log(this.options.cdn_provider);

        const cdnProvider = require(this.options.cdn_provider);

        // 需要处理的模版文件正则
        const pattern = `${this.options.tpl_path}/**/*.${this.options.tpl_suffix}`;

        // 命中的模板文件
        const tpls = glob.sync(pattern, {mark: true});

        cdnCacheFromFile = this._dealCacheFile(cdnCacheFileName);


        // 缓存 CDN 文件上传，避免重复上传
        var resourceTree = [];

        // 遍历模板文件内容，处理其中需要上传CDN的文件
        tpls.forEach( tpl => {
            //获取模板文件中需要上传 CDN 的资源文件名
            var resFileNames = {
                fileName: tpl,
                subResource: this._getResource(tpl)
            };
            resourceTree.push(resFileNames);
        });

        var promises = [];
        resourceTree.forEach(res => {
            var p = this._dealSubResource(res, cdnProvider).then(data => {
                var tplContent = fs.readFileSync(this._getWholePathFile(res.fileName), 'utf8');
                tplContent = this._replace(tplContent, data);
                this._saveFile(res.fileName, tplContent);
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
    },

    //处理上传之后的文件
    _dealSubResource(resourceTree, cdnProvider) {
        var promises = [];
        var suffix = this._getFileSuffix(resourceTree.fileName);
        resourceTree.subResource.forEach(res => {
            if(res.subResource) {
                promises.push(this._dealSubResource(res,  cdnProvider));
            }else {
                promises.push(this._uploadFile(cdnProvider, res.fileName));
            }
        });

        return Promise.all(promises).then(response => {
            console.dir(response);
            // 处理response，将文件缓存
            response.forEach(r => {
                for( var fileName in r ){
                    cdnCacheFromFile[this._md5FileSync(fileName)] = r[fileName];
                }
            });
            console.dir(cdnCacheFromFile);
            // response 是上传完文件的所有子资源地址数组
            if(suffix == 'css'){
                // 替换文件中的资源地址
                var cssContent = fs.readFileSync(this._getWholePathFile(resourceTree.fileName), 'utf8');
                cssContent = this._replace(cssContent, response);
                this._saveFile(resourceTree.fileName, cssContent);
                return this._uploadFile(cdnProvider, resourceTree.fileName);
            }else {
                return Promise.resolve(response);
            }
        });
    },
    _dealCacheFile(cdnCacheFileName) {
        try {
            return JSON.parse(fs.readFileSync(cdnCacheFileName, 'utf8'));
        }catch(e){
            console.log(e);
            return {};
        }
    },

    // 将文件内容 md5
    _md5FileSync (filename) {
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
    },

    //写入指定 output 文件
    _saveFile(file, fileContent)  {
        // 写入指定 output 文件
        var suffix = this._getFileSuffix(file);
        var outputFile;
        if(suffix == 'css') {
            outputFile = this.options.static_path + file;
        }else {
            outputFile = this.options.output_path + path.basename(file);
        }
        console.log('\n---------------outputFile--------');
        console.log(outputFile);
        var stats;
        try{
            stats = fs.statSync(this.options.output_path);
            if(!stats || !stats.isdirectory()){
                mkdirp.sync(this.options.output_path);
                fs.writeFileSync(outputFile, fileContent ,this.options.file_encoding || 'utf8');
            }
        }catch(e){
            mkdirp.sync(this.options.output_path);
            fs.writeFileSync(outputFile, fileContent ,this.options.file_encoding || 'utf8');
        }
    },

    //将相对地址替换成 CDN 地址
    _replace(fileContent, subResCdnUrl) {
        if( subResCdnUrl ){
            subResCdnUrl.forEach(subRes => {
                for(var subResFileName in subRes) {
                    var replaceFileName = subResFileName.substring(this.options.static_path.length, subResFileName.length);
                    fileContent = fileContent.replace(new RegExp(replaceFileName, 'ig'), subRes[subResFileName]);
                }
            });
        }
        return fileContent;
    },

    // 上传文件
    _uploadFile(cdnProvider, fileName) {
        fileName = this._getWholePathFile(fileName);
        if(cdnCache[fileName]) {
            return cdnCache[fileName];
        }
        var md5 = this._md5FileSync(fileName);
        if(cdnCacheFromFile[md5]){
            var promise = Promise.resolve(cdnCacheFromFile[md5]);
            cdnCache[fileName] = uploadPromise;
            return uploadPromise;
        }
        try{
            if(this.options.cdn_provider == '@q/qcdn') {
                console.log('上传文件'+fileName);
                var uploadPromise = cdnProvider.upload(fileName, this.options.plugins[this.options.cdn_provider]);
                cdnCache[fileName] = uploadPromise;
                return uploadPromise;
            }
        }catch(e){
            console.dir(e);
        }
        return Promise.resolve(null);
    },


    // 获取 fileName 文件中所有需要上传的资源名称
    _getResource(fileName) {
        const suffix = this._getFileSuffix(fileName);
        if(suffix != 'css' && suffix != this.options.tpl_suffix) return null;
        const regexObj = this._getRegexes(suffix);
        const fileContent = fs.readFileSync(this._getWholePathFile(fileName), 'utf8');
        var subResource = [],
            resource;
        regexObj.regexes.forEach(regex => {
            while((resource = regex.exec(fileContent))) {
                var match = resource[regexObj.index];
                if(!this._getRegexes('url').test(match)){ //若不是一个url，则 push
                    subResource.push({
                        fileName: resource[regexObj.index],
                        subResource: this._getResource(resource[regexObj.index])
                    });
                }
            }
        });
        return subResource;
    },

    // 根据文件类型获取带路径文件全名
    _getWholePathFile(fileName) {
        const suffix = this._getFileSuffix(fileName);
        const filePath = (suffix == this.options.tpl_suffix) ? '' : this.options.static_path;
        return `${filePath}${fileName}`;
    },

    // 获取文件类型 后缀名
    _getFileSuffix(fileName) {
        const extname = path.extname(fileName);
        return extname.substring(1,extname.length);
    },

    // 根据文件类型获取正则数组
    _getRegexes(type) {
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
            case 'html':
                return {
                    regexes: regexes,
                    index: 0
                }
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

};

module.exports = cdnplz;
