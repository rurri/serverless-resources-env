'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const fs = require('fs');
const dotenv = require('dotenv');

class ServerlessResourcesEnv {

  /**
   * Constructor. Object is created by serverless framework.
   *
   * @param serverless context provided by framework
   * @param options command line options provided by framework
   */
  constructor(serverless, options) {
    // Mark this plug-in as only usable with aws
    this.provider = 'aws';

    // Define our hooks. We only care about modifying things when a full deploy is run as
    // only a function deploy will not modify any CF resources
    this.hooks = {
      'after:deploy:deploy': this.afterDeploy.bind(this),
      'before:invoke:local:invoke': this.beforeLocalInvoke.bind(this),
    };

    // Stash the context away for later
    this.serverless = serverless;
    this.options = options;

    const awsProvider = this.serverless.getProvider('aws');

    // The AWS Region is not set for us yet on the provider
    const region = this.getRegion();

    // Set these on our object for easier injection by unit tests
    this.cloudFormation = new awsProvider.sdk.CloudFormation({ region });
    this.lambda = new awsProvider.sdk.Lambda({ region });
    this.fs = fs;
    this.dotenv = dotenv;
  }

  /**
   * Called by the serverless framework. Will return a promise of completion
   * @returns {Promise.<TResult>}
   */
  afterDeploy() {
    const stackName = this.getStackName();

    // First fetch all of our Resources from AWS by doing a network call
    return this.fetchCFResources().then((resourceResult) => {
      // Map these to an object keyed by the Logical id pointing to the PhysicalId
      const resources = _.reduce(resourceResult.StackResources, (all, item) => {
        all[`CF_${item.LogicalResourceId}`] = item.PhysicalResourceId;
        return all;
      }, {});

      // For each function, update the env files on that function.
      const updatePromises = _.map(_.keys(this.serverless.service.functions), (functionName) => {
        const awsFunctionName = `${stackName}-${functionName}`;
        const resourceList = _.map(
            this.serverless.service.functions[functionName].custom &&
            this.serverless.service.functions[functionName].custom['env-resources'],
            resource => `CF_${resource}`);

        const thisFunctionsResources = _.pick(resources, resourceList);
        const notFoundList = _.difference(resourceList, _.keys(thisFunctionsResources));
        const thisFunctionEnv = _.extend(
            {},
            thisFunctionsResources,
            this.serverless.service.provider.environment || {},
            this.serverless.service.functions[functionName].environment);

        if (notFoundList.length > 0) {
          this.serverless.cli.log(
              `[serverless-resources-env] WARNING: Could not find cloud formation resources for ${functionName}.` +
              `Could not find: ${_.join(notFoundList)}`);
        }
        if (_.keys(thisFunctionsResources).length === 0) {
          this.serverless.cli.log(
              `[serverless-resources-env] No env resources configured for ${functionName}. Clearing env vars`);
        } else {
          this.serverless.cli.log(
              `[serverless-resources-env] Setting env vars for ${functionName}. ${_.join(thisFunctionsResources)}`);
        }
        // Send a lambda update request to
        const awsUpdateResult =
            this.updateFunctionEnv(awsFunctionName, thisFunctionEnv).then((result) => {
              this.serverless.cli.log(
                `[serverless-resources-env] ENV Update for function ${result.FunctionName} successful`);
              return result;
            });
        const createFileResult = this.createCFFile(functionName, thisFunctionsResources);
        return Promise.all([
          awsUpdateResult,
          createFileResult,
        ]);
      });
      // Return a promise that resolves once everything is done.
      return Promise.all(updatePromises);
    });
  }

  beforeLocalInvoke() {
    const fileName = this.getEnvFileName(this.options.function);
    const path = this.getEnvDirectory();
    const fullPath = `${path}/${fileName}`;
    this.serverless.cli.log(`[serverless-resources-env] Pulling in env variables from ${fullPath}`);
    dotenv.config({ path: fullPath });
  }

  /**
   * Updates the environment variables for a single function.
   * @param functionName Name of function to update
   * @param envVars Environment vars to set on the function
   * @returns {Promise.<String>}
   */
  updateFunctionEnv(functionName, envVars) {
    const params = {
      FunctionName: functionName, /* required */
      Environment: {
        Variables: envVars,
      },
    };
    return Promise.promisify(this.lambda.updateFunctionConfiguration.bind(this.lambda))(params);
  }

  /**
   * Looks up the CF Resources for this stack from AWS
   * @returns {Promise.<String>}
   */
  fetchCFResources() {
    const stackName = this.getStackName();
    this.serverless.cli.log(`[serverless-resources-env] Looking up resources for CF Named: ${stackName}`);
    return this.fetchCFResourcesPages(stackName, null, []);
  }

  /**
   * Recursively look up the CF Resource pages for this stack from AWS
   * and concatenate the resource pages
   * @returns {Promise.<String>}
   */
  fetchCFResourcesPages(stackName, nextToken, resourceSummaries) {
    const self = this;
    return new Promise((resolve, reject) => {
      self.cloudFormation.listStackResources(
          { StackName: stackName, NextToken: nextToken },
          (err, resourceResultPage) => {
            if (err == null) {
              if (resourceResultPage.NextToken == null) {
                const results = resourceSummaries.concat(resourceResultPage.StackResourceSummaries);
                self.serverless.cli.log(`[serverless-resources-env] Returned ${results.length} ResourceSummaries`);
                resolve({ StackResources: results });
              } else {
                self.serverless.cli.log('[serverless-resources-env] Getting next Resources page');
                const allSummaries =
                    resourceSummaries.concat(resourceResultPage.StackResourceSummaries);
                resolve(self.fetchCFResourcesPages(
                    stackName,
                    resourceResultPage.NextToken,
                    allSummaries));
              }
            } else {
              reject(err);
            }
          }
      );
    });
  }

  getEnvDirectory() {
    const customDirectory = this.serverless.service.custom && this.serverless.service.custom['resource-output-dir'];
    const directory = customDirectory || '.serverless-resources-env';
    return `${this.serverless.config.servicePath}/${directory}`;
  }

  getEnvFileName(functionName) {
    const stage = this.getStage();
    const region = this.getRegion();
    const customName = this.serverless.service.functions[functionName].custom &&
        this.serverless.service.functions[functionName].custom['resource-output-file'];
    // Check if the filename is overridden, otherwise use .<region>_<stage>-<function>
    return customName || `.${region}_${stage}_${functionName}`;
  }

  /**
   * Creates a local file of all the CF resources for this stack in a .properties format
   * @param resources
   * @returns {Promise}
   */
  createCFFile(functionName, resources) {
    // Check if the filename is overridden, otherwise use /<stage>-env
    const path = this.getEnvDirectory();
    const fileName = this.getEnvFileName(functionName);

    if (!this.fs.existsSync(path)) {
      this.fs.mkdirSync(path, 0o700);
    }

    if (!this.fs.statSync(path).isDirectory()) {
      throw new Error(`Expected ${path} to be a directory`);
    }

    // Log so that the user knows where this file is
    this.serverless.cli.log(`[serverless-resources-env] Writing ${_.keys(resources).length}` +
        ` CF resources to ${fileName}`);

    const fullFileName = `${path}/${fileName}`;
    // Reduce this to a simple properties file format
    const data = _.reduce(resources, (properties, item, key) =>
        `${properties}${key}=${item}\n`, '');
    // Return a promise of this file being written
    return Promise.promisify(this.fs.writeFile)(fullFileName, data);
  }

  /**
   * Checks CLI options and settings to discover the current stage that is being worked on
   * @returns {string}
   */
  getStage() {
    let returnValue = 'dev';
    if (this.options && this.options.stage) {
      returnValue = this.options.stage;
    } else if (this.serverless.config.stage) {
      returnValue = this.serverless.config.stage;
    } else if (this.serverless.service.provider.stage) {
      returnValue = this.serverless.service.provider.stage;
    }
    return returnValue;
  }

  /**
   * Checks CLI options and settings to discover the current region that is being worked on
   * @returns {string}
   */
  getRegion() {
    let returnValue = 'us-east-1';
    if (this.options && this.options.region) {
      returnValue = this.options.region;
    } else if (this.serverless.config.region) {
      returnValue = this.serverless.config.region;
    } else if (this.serverless.service.provider.region) {
      returnValue = this.serverless.service.provider.region;
    }
    return returnValue;
  }

  /**
   * Returns the name of the current Stack.
   * @returns {string}
   */
  getStackName() {
    return `${this.serverless.service.service}-${this.getStage()}`;
  }
}

module.exports = ServerlessResourcesEnv;
