const glob = require('glob');
const fs = require('fs');
const mkdirp = require('mkdirp');
const path = require('path');
const crypto = require('crypto');

var cdnplz = {
    options: {
        tpl_suffix: 'html',   //模板文件后缀名
        tpl_path: 'app/view', //模板根目录
        static_path: '.',  //静态资源的目录
        output_path: 'output/view/', //输出目录
        file_encoding: 'utf8', //文件编码
        cdn_provider: '',
        plugins: {}
    },
    jadeTypeMap: { // 标签与属性的对应关系
        'img': 'src',
        'script': 'src',
        'embed': 'src',
        'link': 'href',
        'object': 'data'
    },
    cdnCache: {},// 缓存文件上传的 Promise
    cdnCacheFromFile: {},// 本地的CDN地址缓存文件
    cdnCacheFileName: './cdn.cache',// 本地的CDN地址缓存文件路径+名称
    resourceTree: [],// 缓存 CDN 文件上传，避免重复上传
    cdnProvider: null,// 用户自定义CDN Provider
    startTime: 0, //记录总用时的start
    init(options) {
        this.startTime = new Date().getTime();
        this.options = Object.assign(this.options, options); // 用户配置覆盖默认配置
        if(!this.checkOption('tpl_path') || !this.checkOption('static_path') || !this.checkOption('cdn_provider')) {
            return false;
        }
        this.cdnProvider = require(this.options.cdn_provider);
        try { //读取cdn.cache文件，返回一个json格式文件，key: md5, value: cdn 地址
            this.cdnCacheFromFile = JSON.parse(fs.readFileSync(this.cdnCacheFileName, 'utf8'));
        }catch(e){
            console.log(e);
        }
        this.start();
    },
    checkOption(opt) {
        if(!this.options[opt]){
            console.error(`ERROR: ${opt} 未配置。`);
            return false;
        }
        return true;
    },
    start() {
        var promises = [];
        const tpls = glob.sync(this._getRegexes('tpl'), {mark: true});// 命中的模板文件
        console.log(tpls);
        // 遍历模板文件内容，处理其中需要上传CDN的文件
        tpls.forEach( tpl => {
            this.resourceTree.push({//获取模板文件中需要上传 CDN 的资源文件名
                fileName: tpl,
                subResource: this._getSubResource(tpl)
            });
        });
        console.log(JSON.stringify(this.resourceTree));
        // 遍历资源树，处理其中的子资源
        promises = this.resourceTree.map(res => 
            this._dealSubResource(res).then(data => 
                this._saveFile(res.fileName, this._replace(fs.readFileSync(this._getWholePathFile(res.fileName), 'utf8'), data));
            ).catch(e => console.log(e));
        );
        // cdn 上传结束
        Promise.all(promises).then(response => 
            fs.writeFileSync(this.cdnCacheFileName, JSON.stringify(this.cdnCacheFromFile));
        );
    },

    //递归处理子资源文件
    _dealSubResource(res) {
        var promises = res.subResource.map(subres => 
            subres.subResource ? this._dealSubResource(subres) : this._uploadFile(subres.fileName)
        );

        return Promise.all(promises).then(response => {
            response.forEach(r => {// 处理response，将文件缓存
                for( var fileName in r ){
                    this.cdnCacheFromFile[this._md5FileSync(fileName)] = r[fileName];
                }
            });
            if(this._getFileSuffix(res.fileName) === 'css'){// 替换CSS文件中的资源地址
                var cssContent = fs.readFileSync(this._getWholePathFile(res.fileName), 'utf8');
                this._saveFile(res.fileName, this._replace(cssContent, response));
                return this._uploadFile(res.fileName);
            } else {
                return Promise.resolve(response);
            }
        });
    },

    // 计算文件内容 md5 值
    _md5FileSync (fileName) {
        var hash = crypto.createHash('md5');
        try {
            hash.update(fs.readFileSync(fileName, this.options.file_encoding));
        }catch(e){
            console.log(e);
        }
        return hash.digest('hex');
    },

    //写入指定 output 文件
    _saveFile(file, fileContent)  {
        console.log(file);
        var outputFile = (this._getFileSuffix(file) == 'css')
                         ? (this.options.static_path + file)
                         : (file.replace(this.options.tpl_path, this.options.output_path));
        try{
            fs.statSync(path.dirname(outputFile)).isdirectory();
        }catch(e){
            mkdirp.sync(path.dirname(outputFile));
        }
        console.log(outputFile)
        fs.writeFileSync(outputFile, fileContent ,this.options.file_encoding || 'utf8');
    },

    //将相对地址替换成 CDN 地址
    _replace(fileContent, subResCdnUrl) {
        if(!subResCdnUrl || !subResCdnUrl.length) return fileContent;
        subResCdnUrl.forEach(subRes => {
            for(var subResFileName in subRes) {
                var replaceFileName = subResFileName.substring(this.options.static_path.length, subResFileName.length);
                fileContent = fileContent.replace(new RegExp(replaceFileName, 'ig'), subRes[subResFileName]);
            }
        });
        return fileContent;
    },

    // 上传文件
    _uploadFile(fileName) {
        fileName = this._getWholePathFile(fileName);
        if(this.cdnCache[fileName]) {  //判断本次是否已经上传过
            return this.cdnCache[fileName];
        }
        var uploadPromise;
        var md5 = this._md5FileSync(fileName); // 判断上一次执行cdnplz是否上传过该文件
        if(this.cdnCacheFromFile[md5]){
            var cache = {};
            cache[fileName] = this.cdnCacheFromFile[md5];
            uploadPromise = Promise.resolve(cache);
            this.cdnCache[fileName] = uploadPromise;
            return uploadPromise;
        }
        try{  // 上传
            console.log('上传文件'+fileName);
            if(this.options.cdn_provider == '@q/qcdn') { //如何处理不同 CDN Provider 不同执行方法的情况？
                uploadPromise = this.cdnProvider.upload(fileName, this.options.plugins[this.options.cdn_provider]);
            }
            this.cdnCache[fileName] = uploadPromise;
            return uploadPromise;
        }catch(e){
            console.dir(e);
        }
        return Promise.resolve(null);
    },

    // 获取 fileName 文件中所有需要上传的资源名称
    _getSubResource(fileName) {
        const suffix = this._getFileSuffix(fileName);
        if(suffix != 'css' && suffix != this.options.tpl_suffix) return null;
        const regexObj = this._getRegexes(suffix);
        const fileContent = fs.readFileSync(this._getWholePathFile(fileName), 'utf8');
        var subResource = [],
            resource;
        return regexObj.regexes.forEach(regex => {
            while((resource = regex.exec(fileContent))) {
                var match = resource[regexObj.index];
                if(!this._getRegexes('url').test(match)){ //若是url，则不处理
                    subResource.push({
                        fileName: resource[regexObj.index],
                        subResource: this._getSubResource(resource[regexObj.index])
                    });
                }
            }
        });
        return subResource;
    },

    // 根据文件类型获取带路径文件全名
    _getWholePathFile(fileName) {
        const filePath = (this._getFileSuffix(fileName) == this.options.tpl_suffix) ? '' : this.options.static_path;
        return `${filePath}${fileName}`;
    },

    // 获取文件类型 后缀名
    _getFileSuffix(fileName) {
        const extname = path.extname(fileName);
        return extname.substring(1, extname.length);
    },

    // 根据文件类型获取正则数组
    _getRegexes(type) {
        var types = Object.keys(this.jadeTypeMa);
        if (type === 'jade')
            return {
                regexes: types.map(type => new RegExp(`${type}(\\s|\\()*(.*?)${this.jadeTypeMap[type]}(\\s|\\'|\\"|\\=)*(.*?)(\\'|\\").*\\)`,'ig'))
                            .concat(types.map(type => new RegExp(`<${type}(\\s)+(.*?)${this.jadeTypeMap[type]}(\\s|\\'|\\"|\\=)*(.*?)(\\'|\\").*?`,'ig'))),
                index: 4
            }
        if (type === 'html')
            return {
                regexes: types.map(type => new RegExp(`<${type}(\\s)+(.*?)${this.jadeTypeMap[type]}(\\s|\\'|\\"|\\=)*(.*?)(\\'|\\").*?`,'ig')),
                index: 4
            }
            
        if (type === 'css')
            return {
                regexes: [/url\((.*?)\)/g],
                index: 1
            };
        
        if (type === 'url')
            return /^(https?\:\/\/)?([a-z\d\-]+\.)+[a-z]{2,6}[\/\?\#]?([\/\?\#][\w|\:|\/|\.|\-|\#|\!|\~|\%|\&|\+|\=|\?|\$]+)?$/i;
        if (type === 'tpl')
            return `${this.options.tpl_path}/**/*.${this.options.tpl_suffix}`;
        
        return {};
    }
};

module.exports = cdnplz;
