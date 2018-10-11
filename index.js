const { validateEvent } = require('hebo/validators');

class EventRepositoryDynamodb {
    constructor({ dynamodbClient, aggregates } = {}) {
        this.aggregates = aggregates;
        this.dynamodbClient = dynamodbClient;
    }

    async getEvents(aggregateName, aggregateId, greaterThanVersion = 0) {
    }

    async writeEvent(aggregateName, aggregateId, event) {
    }
}

module.exports = EventRepositoryDynamodb;
