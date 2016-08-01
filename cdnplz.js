module.exports = cdnplz;

const glob = require('glob');
const fs = require('fs');

function cdnplz(options){

    const pattern = `${options.tpl_path}/**/*.${options.tpl_suffix}`;
    console.log(pattern);

    const tpls = glob.sync(pattern, {mark: true});

    console.log("tpls", tpls);

    tpls.forEach( tpl => {
        const file = fs.readFileSync(tpl, 'utf8');
        console.log(file);
    });
}
