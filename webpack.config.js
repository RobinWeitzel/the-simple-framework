const path = require('path');

module.exports = {
    mode: "development",
    entry: './src/the-simple-framework.js',
    output: {
        filename: 'the-simple-framework.js',
        path: path.resolve(__dirname, 'dist'),
        library: "TSF",
        libraryTarget: 'umd',
    },
    module: {
        rules: [
            {
                test: /\.m?js$/,
                exclude: /(node_modules|bower_components)/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                        plugins: [
                            "transform-custom-element-classes",
                            "@babel/plugin-proposal-class-properties",
                        ]
                    }
                }
            }
        ]
    }
};