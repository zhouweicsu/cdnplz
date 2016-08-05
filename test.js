
const path = require('path');

console.log(_getFileSuffix('./a/b/sc/d/aaa.jade'));
//将相对地址替换成 CDN 地址
function _replace(fileContent, subResCdnUrl) {
    console.dir(subResCdnUrl);
    if( subResCdnUrl ){
        subResCdnUrl.forEach(subRes => {
            for(var subResFileName in subRes) {
                var replaceFileName = subResFileName.substring(_options.static_path.length, subResFileName.length);
                console.log('----------------->>>>>>>>>>>> replace');
                console.log(`${replaceFileName}---->>>>${subRes[subResFileName]}`);
                fileContent.replace(new RegExp(replaceFileName, 'g'), subRes[subResFileName]);
            }
        });
    }
    return fileContent;
}

// 获取文件类型 后缀名
function _getFileSuffix(fileName) {
    const extname = path.extname(fileName);
    return extname.substring(1,extname.length);
}
// 标签与属性的对应关系
const jadeTypeMap = {
    'img': 'src',
    'script': 'src',
    'embed': 'src',
    'link': 'href',
    'object': 'data'
}
// 获取 fileName 文件中所有匹配正则 regexs 的资源名称，index 为正则捕获的索引
function _getResource(fileName, index) {
    //获取文件后缀名
    const extname = path.extname(fileName);
    const suffix = extname.substring(1,extname.length);
    const regexes = _getRegexes(suffix);
    console.log(regexes);
    console.log('读取文件');
    const fileContent = fs.readFileSync(fileName, 'utf8');
    var resources = [],
        resource;
    for(var regex in regexes) {
        while((resouce = regex.exec(fileContent))) {
            resources.push(resource[index]);
        }
    }
    return resources;
}

// 获取正则数组
function _getRegexes(fileType) {
    console.dir(jadeTypeMap);
    jadeTypeMap = jadeTypeMap;
    switch(fileType) {
        case 'jade':
            var regexes = [];
            console.dir(jadeTypeMap);
            for(var type in jadeTypeMap) {
                console.log(type);
                regexes.push(new RegExp(`${type}(\\s|\\()*(.*?)${jadeTypeMap[type]}(\\s|\\'|\\"|\\=)*(.*?)(\\'|\\").*\\)`,'ig'));
            }
            return regexes;
        case 'css':
            return [/url\((.*?)\)/g];
        default:
            return [];
    }
}
