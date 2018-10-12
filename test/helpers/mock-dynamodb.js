const { promisify } = require('util');
const dynalite = require('dynalite');
const AWS = require('aws-sdk');
const memoize = require('memoizee');

const startMockDynamodb = async () => {
    const port = 10000 + Math.round(Math.random() * 10000);
    const dynaliteServer = dynalite({
        createTableMs: 0,
        deleteTableMs: 0,
    });
    const listen = promisify(dynaliteServer.listen);
    await listen.call(dynaliteServer, port);
    return port;
};

const initDb = memoize(
    async () => {
        const port = await startMockDynamodb();
        const client = new AWS.DynamoDB({
            endpoint: `http://localhost:${port}`,
            accessKeyId: 'xxxxxxxxx',
            secretAccessKey: 'yyyyyyyyy',
        });
        const createTable = def => client.createTable(def).promise();

        await createTable({
            TableName: 'bookEvent',
            AttributeDefinitions: [
                { AttributeName: 'bookId', AttributeType: 'S' },
                { AttributeName: 'sequenceNumber', AttributeType: 'N' },
            ],
            KeySchema: [
                { AttributeName: 'bookId', KeyType: 'HASH' },
                { AttributeName: 'sequenceNumber', KeyType: 'RANGE' },
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 1,
                WriteCapacityUnits: 1,
            },
        });

        await createTable({
            TableName: 'authorEvent',
            AttributeDefinitions: [
                { AttributeName: 'authorId', AttributeType: 'S' },
                { AttributeName: 'sequenceNumber', AttributeType: 'N' },
            ],
            KeySchema: [
                { AttributeName: 'authorId', KeyType: 'HASH' },
                { AttributeName: 'sequenceNumber', KeyType: 'RANGE' },
            ],
            ProvisionedThroughput: {
                ReadCapacityUnits: 1,
                WriteCapacityUnits: 1,
            },
        });

        const documentClient = new AWS.DynamoDB.DocumentClient({
            service: client,
        });

        return { client, documentClient };
    },
    { promise: true },
);

module.exports = initDb;
