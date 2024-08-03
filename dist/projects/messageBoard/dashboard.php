<?php
require 'vendor/autoload.php'; // include Composer's autoloader

try {
    // Create a connection to MongoDB
    $client = new MongoDB\Client("mongodb://localhost:27017");
    $articleCollection = $client->myblogsite->articles;
} catch (MongoDB\Driver\Exception\Exception $e) {
    die('Failed to connect to MongoDB: ' . $e->getMessage());
}

$currentPage = isset($_GET['page']) ? (int)$_GET['page'] : 1;
$articlesPerPage = 5;
$skip = ($currentPage - 1) * $articlesPerPage;

$cursor = $articleCollection->find([], [
    'limit' => $articlesPerPage,
    'skip' => $skip,
    'sort' => ['saved_at' => -1]
]);

$totalArticles = $articleCollection->countDocuments();
$totalPages = (int)ceil($totalArticles / $articlesPerPage);
?>

<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="X-UA-Compatible" content="ie=edge">
    <link rel="stylesheet" href="css/style.css">
    <style type="text/css" media="screen">
        body {
            font-size: 13px;
        }

        div#contentarea {
            width: 650px;
        }
    </style>
    <title>My Blog Site Dashboard</title>
</head>

<body>
    <div id="contentarea">
        <div id="innercontentarea">
            <h1>Dashboard</h1>
            <table class="articles" cellspacing="0" cellpadding="0">
                <thead>
                    <tr>
                        <th width="55%">Title</th>
                        <th width="27%">Created at</th>
                        <th width="*">Action</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($cursor as $article): ?>
                        <tr>
                            <td><?php echo substr($article['title'], 0, 35) . '...'; ?></td>
                            <td><?php echo date('g:i a, F j', $article['saved_at']->toDateTime()->getTimestamp()); ?></td>
                            <td class="url">
                                <a href="blog.php?id=<?php echo $article['_id']; ?>">View</a>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
        <div id="navigation">
            <div class="prev">
                <?php if ($currentPage !== 1): ?>
                    <a href="<?php echo $_SERVER['PHP_SELF'] . '?page=' . ($currentPage - 1); ?>">Previous</a>
                <?php endif; ?>
            </div>
            <div class="page-number">
                <?php echo $currentPage; ?>
            </div>
            <div class="next">
                <?php if ($currentPage !== $totalPages): ?>
                    <a href="<?php echo $_SERVER['PHP_SELF'] . '?page=' . ($currentPage + 1); ?>">Next</a>
                <?php endif; ?>
            </div>
            <br class="clear" />
        </div>
    </div>
</body>

</html>
