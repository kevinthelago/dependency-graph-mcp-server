/**
 * Animal+Training.m — category implementation.
 *
 * Tests:
 *   - @implementation ClassName (Category) → category→class association edge
 *   - @import in .m file
 */

#import "Animal+Training.h"

@import UIKit;

@implementation Animal (Training)

- (void)trainWithDuration:(NSTimeInterval)seconds {
    NSLog(@"Training for %f seconds", seconds);
}

- (BOOL)isTrainable {
    return YES;
}

@end
