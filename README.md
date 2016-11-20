[![Build Status](https://travis-ci.org/rurri/serverless-resources-env.svg?branch=master)](https://travis-ci.org/rurri/serverless-resources-env)
[![Coverage Status](https://coveralls.io/repos/github/rurri/serverless-resources-env/badge.svg?branch=master)](https://coveralls.io/github/rurri/serverless-resources-env?branch=master)
[![bitHound Overall Score](https://www.bithound.io/github/rurri/serverless-resources-env/badges/score.svg)](https://www.bithound.io/github/rurri/serverless-resources-env)


A serverless framework plugin so that your functions know how to use resources created by cloudformation.

This plugin will set environment variables on your functions within lambda using the new [Lambda environment variable support](https://aws.amazon.com/about-aws/whats-new/2016/11/aws-lambda-supports-environment-variables/).

It will also create a local env file for optional use in reading in environment variables for a specific stage while running functionals locally. These are by default stored in a file named: `.dev-env` where `dev` is replaced by the appropriate stage name.

## Why?

You have a CloudFormation template all set, and you are writing your functions. Now you are ready to use the
resources created as part of your CF template. Well, you need to know about them!

## Example of Lambda Usage:

```
const sqs_arn = process.env.CF_mySQS;
const my_dynamo_table_name = process.env.CF_myTable;
```

## Example of Local Usage:
You can optionally use the generated .dev-env file to load in variables on local host as well.

```
const require('dotenv).config({silent: true, path:'.dev-env'});

const sqs_arn = process.env.CF_mySQS;
const my_dynamo_table_name = process.env.CF_myTable;
```

## How it works
This plugin attaches to the deploy post-deploy hook. After the stack is deployed to AWS, the plugin determines the name of the cloud formation stack, and queries AWS for all resources in this stack.

After deployment, this plugin, will fetch all the CF resources for the current stack (stage i.e. 'dev'), using the AWS SDK and then set the physical id's of each resource as an environment variable prefixed with `CF_`.

It will also create a file with these values in a .properties file format need `.dev-env`. This can be pulled in by the [dotenv package](https://www.npmjs.com/package/dotenv) or in any way you chose. Each stage will get its own file such as `.stage-env`, such that local code can chose which stage's resources it wants to use.

This means no code changes, or config changes no matter how many regions, and stages you deploy to.

The lambdas always know exactly where to find their resources, whether that resource is a DynamoDB, SQS, SNS, or anything else.

## Install

`npm install serverless-resources-env --save`

Add the plugin to the serverless.yml.

```
plugins:
  - serverless-resources-env
```

**Important Note about aws-sdk version!**

Setting environment variables on Lambda is BRAND NEW on AWS. And you may need to upgrade the version of the package `aws-sdk` being used by the serverless framework. In the 1.1.0 serverless framework, the `aws-sdk` is pegged at version 2.6.8 in the `npm-shrinkwrap.json` of serverless. This will likely be updated at the next serverless release, but in the meantime will require a manual upgrade. 

If you have installed serverless locally as part of your project you can just upgrade the sdk. `npm upgrade aws-sdk`.

If you have installed serverless globally, you will need to change to the serverless directory and run `npm upgrade aws-sdk` from there.  
  
The following commands should get it done:  

```
cd `npm list serverless -g | head -n 1`/node_modules/serverless
npm upgrade aws-sdk  
```

## Common Error

`Unexpected key 'Environment' found in params`. Your aws-sdk is out of date. Setting environment variables on lambdas is brand new. See the Important node above.

## Config

By default, the mapping is written to a .env file located at `.<stage-name>-env`. This can be modified by
setting an option in serverless.yml.

```
custom:
  resource-output-file: .alt-resource-file
```

## PreRequisite

Only works with the aws provider