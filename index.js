'use strict';

const Promise = require('bluebird');
const _ = require('lodash');
const fs = require('fs');

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
    };

    // Stash the context away for later
    this.serverless = serverless;
    this.options = options;

    const awsProvider = this.serverless.getProvider('aws');
    // Set these on our object for easier injection by unit tests
    this.cloudFormation = new awsProvider.sdk.CloudFormation();
    this.lambda = new awsProvider.sdk.Lambda();
    this.fs = fs;
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
      // Make an array to track all each promise related to our task
      const finishedPromises = [];

      // Create the Local CF File
      finishedPromises.push(this.createCFFile(resources));
      // For each function, update the env files on that function.
      const updatePromises = _.map(_.keys(this.serverless.service.functions), (functionName) => {
        const awsFunctionName = `${stackName}-${functionName}`;
        return this.updateFuctionEnv(awsFunctionName, resources);
      });
      // Add the updatePromies as part of our promise list for finishing
      finishedPromises.concat(updatePromises);

      // Print Debug information for each successful promise
      Promise.each(updatePromises, (result) => {
        this.serverless.cli.log(
            `[serverless-resources-env] ENV Update for function ${result.FunctionName} successful`);
      });
      // Return a promise that resolves once everything is done.
      return Promise.all(updatePromises);
    });
  }

  /**
   * Updates the environment variables for a single function.
   * @param functionName Name of function to update
   * @param envVars Environment vars to set on the function
   * @returns {Promise.<String>}
   */
  updateFuctionEnv(functionName, envVars) {
    this.serverless.cli.log(`[serverless-resources-env] Setting env vars for ${functionName}`);
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
    return Promise.promisify(this.cloudFormation.describeStackResources.bind(this.cloudFormation))({
      StackName: stackName,
    });
  }

  /**
   * Creates a local file of all the CF resources for this stack in a .properties format
   * @param resources
   * @returns {Promise}
   */
  createCFFile(resources) {
    const stage = this.getStage();
    // Check if the filename is overridden, otherwise use /<stage>-env
    const fileName =
        this.serverless.service.custom && this.serverless.service.custom['resource-output-file'] ?
            this.serverless.service.custom['resource-output-file'] : `.${stage}-env`;

    // Log so that the user knows where this file is
    this.serverless.cli.log(`[serverless-resources-env] Writing ${_.keys(resources).length}` +
        ` CF resources to ${fileName}`);

    const fullFileName = `${this.serverless.config.servicePath}/${fileName}`;
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
   * Returns the name of the current Stack.
   * @returns {string}
   */
  getStackName() {
    return `${this.serverless.service.service}-${this.getStage()}`;
  }
}

module.exports = ServerlessResourcesEnv;
