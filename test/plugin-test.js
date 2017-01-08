'use strict';

const expect = require('chai').expect;
const sinon = require('sinon');

const ServerlessFetchStackResources = require('../index');
const _ = require('lodash');
const parse = require('properties-parser').parse;

const serverlessStub = {
  config: {
    servicePath: '.',
  },
  service: {
    service: 'unit-test-service',
    provider: {},
    functions: {
      function1: {},
      function2: {},
    },
  },
  cli: {
    log: sinon.stub(),
  },
  getProvider: () => ({
    sdk: {
      CloudFormation: Object,
      Lambda: Object,
    },
  }),
};

describe('serverless-fetch-stack-resource', () => {
  describe('constructor', () => {
    it('should setup to listen for hooks', () => {
      const instance = new ServerlessFetchStackResources(serverlessStub, {});
      expect(instance.hooks).to.have.keys('after:deploy:deploy', 'before:invoke:local:invoke');

      expect(instance.provider).to.equal('aws');
      expect(instance.serverless).to.equal(serverlessStub);
    });
  });

  describe('getStage', () => {
    it('uses dev if no options set', () => {
      const instance = new ServerlessFetchStackResources(
          serverlessStub, {});
      expect(instance.getStage()).to.equal('dev');
    });

    it('uses stage of option if set', () => {
      const instance = new ServerlessFetchStackResources(
          serverlessStub, { stage: 'from_option' });
      expect(instance.getStage()).to.equal('from_option');
    });

    it('uses stage of config if set', () => {
      const instance = new ServerlessFetchStackResources(
          _.extend({}, serverlessStub, {
            config: { stage: 'from_config' },
            service: { provider: {} },
          }), {});
      expect(instance.getStage()).to.equal('from_config');
    });

    it('uses stage of config if set', () => {
      const instance = new ServerlessFetchStackResources(
          _.extend({}, serverlessStub, { service: { provider: { stage: 'from_provider' } } }), {});
      expect(instance.getStage()).to.equal('from_provider');
    });

    it('options will preempt other stages set', () => {
      const instance = new ServerlessFetchStackResources(
          _.extend({}, serverlessStub, {
            config: { stage: 'from_config' },
            service: { provider: { stage: 'from_provider' } },
          }), { stage: 'from_option' });
      expect(instance.getStage()).to.equal('from_option');
    });
  });

  describe('getRegion', () => {
    it('uses us-east-1 if no options set', () => {
      const instance = new ServerlessFetchStackResources(
          serverlessStub, {});
      expect(instance.getRegion()).to.equal('us-east-1');
    });

    it('uses region of option if set', () => {
      const instance = new ServerlessFetchStackResources(
          serverlessStub, { region: 'from_option' });
      expect(instance.getRegion()).to.equal('from_option');
    });

    it('uses region of config if set', () => {
      const instance = new ServerlessFetchStackResources(
          _.extend({}, serverlessStub, {
            config: { region: 'from_config' },
            service: { provider: {} },
          }), {});
      expect(instance.getRegion()).to.equal('from_config');
    });

    it('uses region of config provider if set', () => {
      const instance = new ServerlessFetchStackResources(
          _.extend({}, serverlessStub, { service: { provider: { region: 'from_provider' } } }), {});
      expect(instance.getRegion()).to.equal('from_provider');
    });
  });

  describe('getStackName', () => {
    it('simple combination of service and stage', () => {
      const instance = new ServerlessFetchStackResources(
          _.extend({}, serverlessStub, {
            config: {},
            service: { service: 'a_service', provider: {} },
          }), { stage: 'from_option' });
      expect(instance.getStackName()).to.equal('a_service-from_option');
    });
  });

  describe('fetchCFResources', () => {
    it('Will use sdk to fetch resource informaiton from AWS', () => {
      const instance = new ServerlessFetchStackResources(_.extend({}, serverlessStub));

      const resources = [
        { LogicalResourceId: 'a', PhysicalResourceId: '1' },
        { LogicalResourceId: 'b', PhysicalResourceId: '2' },
        { LogicalResourceId: 'c', PhysicalResourceId: '3' },
      ];
      instance.cloudFormation.describeStackResources =
          (params, callback) => {
            callback(null, {
              StackResources: resources,
            });
          };

      return instance.fetchCFResources().then((result) => {
        expect(result.StackResources).to.deep.equal(resources);
        return true;
      });
    });
  });

  describe('createCFFile', () => {
    it('Will create a file with the given set of resources with default filename', (done) => {
      const resources = { a: '1', b: '2', c: '3' };
      const instance = new ServerlessFetchStackResources(_.extend({}, serverlessStub));
      instance.fs = _.cloneDeep(instance.fs);
      instance.fs.writeFile = (fileName, data) => {
        expect(parse(data)).to.deep.equal(resources);
        expect(fileName).to.equal('./.serverless-resources-env/.us-east-1_dev_function1');
        done();
      };
      instance.createCFFile('function1', resources);
    });

    it('Will use config filename if it exists', (done) => {
      const resources = { a: '1', b: '2', c: '3' };
      const instance = new ServerlessFetchStackResources(_.extend({}, serverlessStub));
      instance.serverless.service.functions.function1.custom = { 'resource-output-file': 'customName' };
      instance.fs = _.cloneDeep(instance.fs);
      instance.fs.writeFile = (fileName, data) => {
        expect(parse(data)).to.deep.equal(resources);
        expect(fileName).to.equal('./.serverless-resources-env/customName');
        done();
      };
      instance.createCFFile('function1', resources);
    });

    it('Will create the directory if it does not exist', (done) => {
      const resources = { a: '1', b: '2', c: '3' };
      const instance = new ServerlessFetchStackResources(
          _.cloneDeep(serverlessStub));
      instance.serverless.service.custom = { 'resource-output-dir': 'custom-dir' };
      instance.serverless.service.functions.function1.custom = { 'resource-output-file': 'customName' };

      instance.fs = _.cloneDeep(instance.fs);
      instance.fs.mkdirSync = sinon.stub();
      instance.fs.statSync = () => ({ isDirectory: () => true });
      instance.fs.writeFile = (fileName, data) => {
        expect(parse(data)).to.deep.equal(resources);
        expect(fileName).to.equal('./custom-dir/customName');
        sinon.assert.calledWith(instance.fs.mkdirSync, './custom-dir', 0o700);
        done();
      };
      instance.createCFFile('function1', resources);
    });

    it('Will error if the directory given exists but is not a directory', (done) => {
      const resources = { a: '1', b: '2', c: '3' };
      const instance = new ServerlessFetchStackResources(
          _.cloneDeep(serverlessStub));
      instance.serverless.service.custom = { 'resource-output-dir': 'custom-dir' };
      instance.serverless.service.functions.function1.custom = { 'resource-output-file': 'customName' };

      instance.fs = _.cloneDeep(instance.fs);
      instance.fs.mkdirSync = sinon.stub();
      instance.fs.statSync = () => ({ isDirectory: () => false });
      instance.fs.existsSync = () => true;
      try {
        instance.createCFFile('function1', resources);
        done('Expected an exception for a non-directory filename');
      } catch (error) {
        done();
      }
    });
  });

  describe('updateFunctionEnv', () => {
    it('Uses aws sdk to update a function\'s env settings', () => {
      const resources = { CF_a: '1', CF_b: '2', CF_c: '3' };
      const instance = new ServerlessFetchStackResources(_.extend({}, serverlessStub));
      instance.lambda.updateFunctionConfiguration = (params, callback) => {
        expect(params).to.deep.equal({
          FunctionName: 'UnitTestFunctionName',
          Environment: {
            Variables: resources,
          },
        });
        callback(null, true);
      };
      return instance.updateFunctionEnv('UnitTestFunctionName', resources);
    });
  });

  describe('beforeLocalInvoke', () => {
    it('Should call dotenv based on stage', () => {
      const instance = new ServerlessFetchStackResources(_.extend({}, serverlessStub), { function: 'function1' });

      sinon.stub(instance, 'getEnvFileName').returns('unit-test-filename');
      sinon.stub(instance.dotenv, 'config').returns(true);
      instance.beforeLocalInvoke();
      sinon.assert.calledWith(instance.dotenv.config, { path: './.serverless-resources-env/unit-test-filename' });
    });
  });

  describe('afterDeploy', () => {
    it('Calls updateFunction for each function', () => {
      const instance = new ServerlessFetchStackResources(_.extend({}, _.cloneDeep(serverlessStub)));
      const resourceList = ['a', 'b', 'c'];
      instance.serverless.service.functions.function1.custom = { 'env-resources': resourceList };
      instance.serverless.service.functions.function2.custom = { 'env-resources': resourceList };
      instance.serverless.service.functions.function3 = {};
      instance.serverless.service.functions.function4 = { custom: { 'env-resources': ['unknown'] } };
      const resources = [
        { LogicalResourceId: 'a', PhysicalResourceId: '1' },
        { LogicalResourceId: 'b', PhysicalResourceId: '2' },
        { LogicalResourceId: 'c', PhysicalResourceId: '3' },
      ];
      const mappedResources = {
        CF_a: '1',
        CF_b: '2',
        CF_c: '3',
      };
      sinon.stub(instance, 'fetchCFResources').returns(Promise.resolve({ StackResources: resources }));
      sinon.stub(instance, 'updateFunctionEnv').returns(Promise.resolve(true));
      sinon.stub(instance, 'createCFFile').returns(Promise.resolve(true));
      return instance.afterDeploy().then(() => {
        sinon.assert.calledOnce(instance.fetchCFResources);
        sinon.assert.calledWith(instance.updateFunctionEnv, 'unit-test-service-dev-function1', mappedResources);
        sinon.assert.calledWith(instance.updateFunctionEnv, 'unit-test-service-dev-function2', mappedResources);
        sinon.assert.calledWith(instance.updateFunctionEnv, 'unit-test-service-dev-function3', {});
        sinon.assert.calledWith(instance.updateFunctionEnv, 'unit-test-service-dev-function4', {});
        return true;
      });
    });
  });
});
