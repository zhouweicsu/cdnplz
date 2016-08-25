const cdnplz = require('cdnplz');

try{
    new cdnplz({
        tpl_suffix: 'html,jade',   //the suffix of template file
        tpl_path: 'app/view', //the root path of template file
        static_path: '.',  //the path of the static file
        output_path: 'output/view/', //the output path of template file
        file_encoding: 'utf8',
        cdn_provider: 'qcdn',//the cdn provider provided by user
        cdn_options: {//the options of the cdn provider
            https: true
        }
    }).start();
}catch(e){
    console.log(e);
}
