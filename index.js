var postcss = require('postcss');
var cssnext = require('cssnext');
var path = require('path');
var _ = require('./utils/components');
var Tag = require('./lib/tag');

/*
 * 注意：利用fis.file(path)生成的file对象是新的
 * 也就是说，在compile阶段的插件，没有办法获取到其他file对象
 * 不像在package阶段有ret对象可以获取任意file对象
 * 因此，为了效率，在这个插件里统一做简单的缓存
 * 
 * 这里做的缓存只是对自己负责的工作qjs编译内容进行缓存
 * 为了内聚，这里把qjs相关的内容都放在file.qData里面
 * 
 */
var cache = {};
fis.on('release:end', function() {
    // 每次处理完都需要重置cache
    cache = {};
});
// cache end


function processHtml(content, file, settings) {
    var tag;
    var componentName;

    if (!file.isHtmlLike ||
        !file.isQHtml ||
        file.qData) {
        return content;
    }

    componentName = _.getComName(file.subpath);
    if (cache[componentName]) { // 之前编译过
        file.qData = cache[componentName].qData;
        return content;
    }

    file.qData = {};
    file.qData.name = componentName;
    tag = new Tag(content, componentName, {
        ret: 'function'
    });
    file.qData.cDeps = tag.dependences;
    file.qData.extend = tag.extend;
    file.qData.qTpl = tag.tpl;
    // console.log('html compile:', componentName, file.qData.cDeps, file.qData.extend);

    // cache
    cache[componentName] = file;

    // clear
    tag.destroy();
    tag = null;

    return content;
}

module.exports = function(content, file, settings) {
    var relFile;
    var componentName;
    var childComponets;
    var thirdComponets;
    var relativePath;
    var contenter;

    // console.log('preprocess-ques begin:', file.id);
    // console.log('file', file.isHtmlLike, file.id, file.subpath);
    // console.log('conf', settings);

    if (file.isHtmlLike) { // html
        // console.log('com html:', file.id, file.subpath);
        content = processHtml(content, file, settings);
    } else if (file.isJsLike) { // js
        if (!_.isComFile(file.subpath)) {
            return content;
        }

        componentName = _.getComName(file.subpath);
        relativePath = path.relative(_.getComPath(componentName), _.COMDIRPATH).replace(/\\/g, '\/');
        // console.log('com js:', file.id, file.subpath, componentName, relativePath);

        if (!cache[componentName]) {
            relFile = fis.file(_.getComPath(componentName, 'main.html'));
            processHtml(relFile.getContent(), relFile, settings);
        }

        relFile = cache[componentName];
        // console.log('rel com:', relFile.qData.cDeps.values());
        childComponets = relFile.qData.cDeps.values().filter(function(v) {
            return !/^ui-/.test(v) && !/^third-/.test(v);
        });
        thirdComponets = relFile.qData.cDeps.values().filter(function(v) {
            return /^third-/.test(v);
        });

        // set component
        childComponets.forEach(function(name) {
            // console.log('child com:', name);
            var path = name.split('-').join('/');
            content = [
                ("Q.define('{{name}}', require('" + relativePath + "/{{path}}/main'));").replace(/\{\{path\}\}/g, path)
                .replace(/\{\{name\}\}/g, name),
                content
            ].join('\n');
        });

        // set third party component
        thirdComponets.forEach(function(name) {
            // console.log('third child com:', name);
            var path = name.split('-').join('/');
            content = [
                ("Third.key('{{name}}', require('" + relativePath + "/{{path}}/main'));").replace(/\{\{path\}\}/g, path)
                .replace(/\{\{name\}\}/g, name),
                content
            ].join('\n');
        });

        // require Q
        childComponets.length && (content = [
            "var Q = require('Q');",
            content
        ].join('\n'));

        // require third party cache
        thirdComponets.length && (content = [
            "var Third = require('third');",
            content
        ].join('\n'));

        // set the extend name in options
        relFile.qData.extend && (content = [
            content,
            "Q.require('" + relFile.qData.extend + "').define('" + componentName + "', module.exports);",
            "module.exports.__extend__ = '" + relFile.qData.extend + "';",
            "module.exports.name = '" + componentName + "';"
        ].join('\n'));
    } else if (file.isCssLike) { // css
        // console.log('cssnext:', settings && settings.cssnext);
        contenter = postcss().use(cssnext(settings && settings.cssnext));
        content = contenter.process(content, { from: file.realpath }).css;
        content = _.fix(content, file.subpath);
    }

    return content;
};
