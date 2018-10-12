const assert = require('assert');
const { omit, isPlainObject, isString, forEach } = require('lodash');
const { compose } = require('lodash/fp');
const AWS = require('aws-sdk');
const { QueryIterator } = require('@aws/dynamodb-query-iterator');
const { ExpressionAttributes } = require('@aws/dynamodb-expressions');
const { Marshaller } = require('@aws/dynamodb-auto-marshaller');
const memoize = require('memoizee');
const { validateEvent } = require('hebo-validation');

const assertValidAggregateConfig = (config, name) => {
    const fullMsg = msg =>
        `EventRepositoryInmemory: invalid aggregate configuration for ` +
        `"${name}": ${msg}`;

    assert(isPlainObject(config), fullMsg('must be a plain object'));
    assert(isString(config.tableName), fullMsg('bad/missing tableName'));
    assert(
        isString(config.aggregateIdField),
        fullMsg('bad/missing aggregateIdField'),
    );
};

class EventRepositoryDynamodb {
    constructor({ dynamodbClient, aggregates } = {}) {
        assert(aggregates, 'EventRepositoryDynamodb: aggregates required');
        assert(
            isPlainObject(aggregates),
            'EventRepositoryInmemory: aggregates must be a plain object',
        );
        forEach(aggregates, assertValidAggregateConfig);

        assert(
            dynamodbClient,
            'EventRepositoryDynamodb: dynamodbClient required',
        );
        assert(
            dynamodbClient instanceof AWS.DynamoDB,
            'EventRepositoryDynamodb: invalid dynamodbClient',
        );

        this.aggregates = aggregates;
        this.dynamodbClient = dynamodbClient;
        this.documentClient = memoize(this.documentClient.bind(this));
    }

    documentClient() {
        return new AWS.DynamoDB.DocumentClient({
            service: this.dynamodbClient,
        });
    }

    assertValidAggregate(label, aggregateName) {
        assert(
            this.aggregates[aggregateName],
            `event respository: ${label}: unknown aggregate "${aggregateName}"`,
        );
    }

    tableName(aggregateName) {
        return this.aggregates[aggregateName].tableName;
    }

    aggregateIdField(aggregateName) {
        return this.aggregates[aggregateName].aggregateIdField;
    }

    async getEvents(aggregateName, aggregateId, greaterThanVersion = 0) {
        this.assertValidAggregate('getEvents', aggregateName);
        const attributes = new ExpressionAttributes();

        const aggregateIdField = this.aggregateIdField(aggregateName);
        const escapedAggregateId = attributes.addName(aggregateIdField);
        const escapedAggregateIdVal = attributes.addValue(aggregateId);

        const escapedSequenceNumber = attributes.addName('sequenceNumber');
        const escapedSequenceNumberVal = attributes.addValue(
            greaterThanVersion + 1,
        );

        const keyExpression =
            `${escapedAggregateId} = ${escapedAggregateIdVal} ` +
            `and ${escapedSequenceNumber} >= ${escapedSequenceNumberVal}`;

        const params = {
            TableName: this.tableName(aggregateName),
            KeyConditionExpression: keyExpression,
            ExpressionAttributeNames: attributes.names,
            ExpressionAttributeValues: attributes.values,
        };
        const iterator = new QueryIterator(this.dynamodbClient, params);
        const marshaller = new Marshaller({ unwrapNumbers: true });
        const records = [];

        // Add aggregateName, aggregateId to final result, remove custom
        // aggregateId field
        const transformAggregateDetails = item => ({
            ...omit(item, aggregateIdField),
            aggregateName,
            aggregateId: item[aggregateIdField],
        });

        // Applied to every item fetched from dynamodb.
        const transformItem = compose(
            transformAggregateDetails,
            marshaller.unmarshallItem.bind(marshaller),
        );

        // This is an ugly implementation of an async iterator, which won't be
        // available until Node 10.
        // http://thecodebarbarian.com/getting-started-with-async-iterators-in-node-js
        for (
            let { value, done } = await iterator.next();
            !done;
            // eslint-disable-next-line no-await-in-loop
            { value, done } = await iterator.next()
        ) {
            records.push(transformItem(value));
        }

        return records;
    }

    async writeEvent(event) {
        const { aggregateName, aggregateId } = event;
        this.assertValidAggregate('writeEvent', aggregateName);
        validateEvent(event);

        const attributes = new ExpressionAttributes();
        const aggregateIdField = this.aggregateIdField(aggregateName);
        const escapedAggregateId = attributes.addName(aggregateIdField);

        const params = {
            TableName: this.tableName(aggregateName),
            Item: {
                [aggregateIdField]: aggregateId,
                ...omit(event, ['aggregateName', 'aggregateId']),
            },
            ConditionExpression: `attribute_not_exists(${escapedAggregateId})`,
            ExpressionAttributeNames: attributes.names,
        };

        let success = false;
        try {
            await this.documentClient()
                .put(params)
                .promise();
            success = true;
        } catch (err) {
            if (err.code !== 'ConditionalCheckFailedException') {
                throw err;
            }
        }
        return success;
    }
}

module.exports = EventRepositoryDynamodb;
