/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var fs = require('fs');
var path = require('path');
var assert = require('assert');

var issues = require('../issues.js');
var pullrequests = require('../pullrequests.js');
var cron = require('../cron.js');
var config = require('../config.js');
var mocks = require('./mocks.js');

// Label mapping configuration
var config_json = require('./mock_data/config.json');
var bot_config = new config.BotConfig(config_json);

// Issue event handler
var issue_handler = new issues.IssueHandler(
  new mocks.MockGithubClient(),
  new mocks.MockEmailClient(),
  bot_config
);

// Issue event handler
var pr_handler = new pullrequests.PullRequestHandler(
  new mocks.MockGithubClient(),
  new mocks.MockEmailClient(),
  bot_config
);

// Cron handler
var cron_handler = new cron.CronHandler(new mocks.MockGithubClient());

// Standard repo
var test_repo = {
  name: 'BotTest',
  owner: {
    login: 'samtstern'
  }
};

// Issue with the template properly filled in
var good_issue = {
  title: 'A good issue',
  body: fs
    .readFileSync(path.join(__dirname, 'mock_data', 'issue_template_filled.md'))
    .toString()
};

// Issue that is just the empty template
var bad_issue = {
  body: fs
    .readFileSync(path.join(__dirname, 'mock_data', 'issue_template_empty.md'))
    .toString()
};

// Issue that is partially filled out
var partial_issue = {
  body: fs
    .readFileSync(
      path.join(__dirname, 'mock_data', 'issue_template_partial.md')
    )
    .toString()
};

// Issue from the JS SDK that was not labeled 'auth' but should have been
var failed_auth_issue = require('./mock_data/issue_opened_js_sdk.json');

// Issue from the JS SDk that was not labeled 'database' but should have been
var failed_db_issue = require('./mock_data/issue_database_not_tagged.json');

// Issue that is really a feature request
var fr_issue = {
  title: 'FR: I want to change the Firebase',
  body: bad_issue.body
};

// Some mock events
var opened_evt = require('./mock_data/issue_opened.json');
var empty_evt = require('./mock_data/issue_opened_empty.json');
var comment_evt = require('./mock_data/comment_created.json');
var only_product_evt = require('./mock_data/issue_opened_filled_only_product.json');

describe('The OSS Robot', () => {
  it('should handle issue opened', () => {
    return issue_handler.handleIssueEvent(
      {},
      'opened',
      opened_evt.issue,
      opened_evt.repository,
      opened_evt.sender
    );
  });

  it('should handle comment created', () => {
    return issue_handler.handleIssueCommentEvent(
      {},
      'created',
      comment_evt.issue,
      comment_evt.comment,
      comment_evt.repository,
      comment_evt.sender
    );
  });

  it('should check a good issue against the template', () => {
    return issue_handler
      .checkMatchesTemplate('foo', 'bar', good_issue)
      .then(res => {
        assert.ok(res.matches, 'Matches template.');
      });
  });

  it('should check a bad issue against the template', () => {
    return issue_handler
      .checkMatchesTemplate('foo', 'bar', bad_issue)
      .then(res => {
        assert.ok(!res.matches, 'Does not match template.');
      });
  });

  it('should detect a partially mangled issue', () => {
    return issue_handler
      .checkMatchesTemplate('foo', 'bar', partial_issue)
      .then(res => {
        assert.ok(!res.matches, 'Does not match template');
      });
  });

  it('should correctly handle a totally empty issue template', () => {
    return issue_handler.handleIssueEvent(
      empty_evt,
      'opened',
      empty_evt.issue,
      test_repo,
      'samtstern'
    );
  });

  it('should handle a partially correct issue', () => {
    var issue = only_product_evt.issue;

    // Should match the auth issue
    var label = issue_handler.getRelevantLabel('samtstern', 'BotTest', issue);
    assert.equal(label, 'auth', 'Label is auth.');

    // Should fail the tempalte check for not filling out all sections
    return issue_handler.checkMatchesTemplate('foo', 'bar', issue).then(res => {
      assert.ok(!res.matches, 'Does not fully match template.');
      assert.ok(
        res.message.indexOf('Hmmm') == -1,
        "Message does not contain 'Hmm.'"
      );
      assert.ok(
        res.message.indexOf('forgot to') > -1,
        "Message does contain 'forgot to'."
      );
    });
  });

  it('should correctly identify a feature request', () => {
    assert.ok(issue_handler.isFeatureRequest(fr_issue), 'Is a feature request');
    assert.ok(
      !issue_handler.isFeatureRequest(bad_issue),
      'Is not a feature request'
    );
  });

  it('should correctly identify a real auth issue', () => {
    var issue = failed_auth_issue.issue;
    issue_handler.onNewIssue(test_repo, issue);
  });

  it('should correctly label a real database issue', () => {
    var issue = failed_db_issue.issue;
    var label = issue_handler.getRelevantLabel('samtstern', 'BotTest', issue);
    assert.ok(label == 'database', 'Is a database issue');
  });

  it('should respect template configs', () => {
    var custom = bot_config.getRepoTemplateConfig(
      'samtstern',
      'BotTest',
      'issue'
    );
    assert.ok(
      custom == '.github/ISSUE_TEMPLATE.md',
      'Finds the custom template'
    );

    var regular = bot_config.getRepoTemplateConfig('foo', 'bar', 'issue');
    assert.ok(regular === undefined, 'Does not find an unspecified template');
  });

  it('should send emails when a recognized label is added', () => {
    return issue_handler.onIssueLabeled(test_repo, good_issue, 'auth');
  });

  it('should not send emails when a random label is added', () => {
    return issue_handler.onIssueLabeled(test_repo, good_issue, 'foo');
  });

  it('should correctly clean up old pull requests', () => {
    return cron_handler.handleCleanup('samtstern', 'BotTest', 0);
  });

  it('should detect issue link in a PR', () => {
    pr_none = {
      body: 'Hey this is bad!'
    };

    assert.ok(!pr_handler.hasIssueLink('foo', pr_none), 'Has no link.');

    pr_shortlink = {
      body: 'Hey this is in reference to #4'
    };

    assert.ok(pr_handler.hasIssueLink('foo', pr_shortlink), 'Has short link.');

    pr_longlink = {
      body:
        'Hey this is in reference to https://github.com/samtstern/BotTest/issues/4'
    };

    assert.ok(pr_handler.hasIssueLink('foo', pr_longlink), 'Has long link.');
  });

  it('should skip some PRs', () => {
    pr_skip = {
      title: "[triage-skip] Don't triage me"
    };

    assert.ok(pr_handler.hasSkipTag('foo', pr_skip), 'Has skip tag');

    pr_triage = {
      title: 'Hey whatever'
    };

    assert.ok(
      !pr_handler.hasSkipTag('foo', pr_triage),
      'Does not have skip tag'
    );
  });
});
